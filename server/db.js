import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'pyq.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const SCHEMA_VERSION = 2;

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const papersTable = (name) => `
  CREATE TABLE ${name} (
    id            INTEGER PRIMARY KEY,
    subject_id    INTEGER NOT NULL REFERENCES subjects(id),
    exam_year     INTEGER NOT NULL,
    exam_type     TEXT NOT NULL CHECK (exam_type IN ('mid', 'end', 'quiz')),
    quiz_label    TEXT,          -- quizzes only: "Quiz 2", "Surprise quiz"
    held_on       TEXT,          -- quizzes only: YYYY-MM-DD, when known
    file_key      TEXT NOT NULL,
    file_hash     TEXT NOT NULL UNIQUE,
    file_size     INTEGER NOT NULL,
    original_name TEXT,
    note          TEXT,
    uploader_id   INTEGER REFERENCES users(id),
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
    reject_reason TEXT,
    reviewed_by   INTEGER REFERENCES users(id),
    reviewed_at   TEXT,
    views         INTEGER NOT NULL DEFAULT 0,
    downloads     INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );`;

const subjectsTable = (name) => `
  CREATE TABLE ${name} (
    id      INTEGER PRIMARY KEY,
    code    TEXT NOT NULL UNIQUE,
    name    TEXT NOT NULL,
    ltp     TEXT,              -- lecture-tutorial-practical hours, e.g. "3-1-0"
    credits INTEGER
  );`;

// A course can be taught in several programmes, in a different semester in each,
// so which programme and semester it belongs to lives in offerings, not on the course.
const OFFERINGS_TABLE = `
  CREATE TABLE offerings (
    subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    branch_code TEXT NOT NULL REFERENCES branches(code),
    semester    INTEGER CHECK (semester BETWEEN 1 AND 8), -- NULL for electives
    category    TEXT NOT NULL,     -- BSC, ESC, HSC, PC, PSE (elective), MLC
    source      TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('curriculum', 'admin')),
    PRIMARY KEY (subject_id, branch_code)
  );
  CREATE INDEX offerings_branch ON offerings(branch_code, semester);`;

const INDEXES = `
  CREATE INDEX papers_subject ON papers(subject_id, status);
  CREATE INDEX papers_status ON papers(status, created_at);`;

function createSchema() {
  db.exec(`
    CREATE TABLE users (
      id            INTEGER PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
      verified      INTEGER NOT NULL DEFAULT 0,
      verify_token  TEXT,
      banned        INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE branches (
      code     TEXT PRIMARY KEY,
      name     TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );
    ${subjectsTable('subjects')}
    ${OFFERINGS_TABLE}
    ${papersTable('papers')}
    ${INDEXES}
    CREATE TABLE events (
      id         INTEGER PRIMARY KEY,
      type       TEXT NOT NULL CHECK (type IN ('view', 'download', 'search', 'upload', 'signup')),
      paper_id   INTEGER REFERENCES papers(id) ON DELETE SET NULL,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      detail     TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX events_type_time ON events(type, created_at);
  `);
}

// Version 1 kept one branch and year on each course and allowed only mid/end-sem papers.
// Rebuilds subjects and papers keeping their ids, so accounts, papers and stats survive.
// New tables are built under temporary names and renamed last: renaming the old tables
// first would make SQLite repoint the foreign keys in events at the tables being dropped.
function migrateFrom1() {
  db.exec('PRAGMA foreign_keys = OFF');
  tx(() => {
    db.exec(`
      ALTER TABLE branches ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
      ${subjectsTable('subjects_new')}
      ${papersTable('papers_new')}
      INSERT INTO subjects_new (id, code, name) SELECT id, code, name FROM subjects;
      INSERT INTO papers_new (id, subject_id, exam_year, exam_type, file_key, file_hash, file_size,
                              original_name, note, uploader_id, status, reject_reason, reviewed_by,
                              reviewed_at, views, downloads, created_at)
        SELECT id, subject_id, exam_year, exam_type, file_key, file_hash, file_size, original_name,
               note, uploader_id, status, reject_reason, reviewed_by, reviewed_at, views, downloads,
               created_at
          FROM papers;
      DROP TABLE papers;
      DROP TABLE subjects;
      ALTER TABLE subjects_new RENAME TO subjects;
      ALTER TABLE papers_new RENAME TO papers;
      ${INDEXES}
      ${OFFERINGS_TABLE}
    `);
  });
  db.exec('PRAGMA foreign_keys = ON');
  const broken = db.prepare('PRAGMA foreign_key_check').all();
  if (broken.length) throw new Error(`Migration left ${broken.length} broken references`);
}

function migrate() {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version >= SCHEMA_VERSION) return;
  const hasTables = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'subjects'").get();
  if (!hasTables) createSchema();
  else if (version < 2) {
    migrateFrom1();
    console.log('Migrated database to schema version 2 (programmes, semesters and quizzes)');
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

export function logEvent(type, { paperId = null, userId = null, detail = null } = {}) {
  db.prepare('INSERT INTO events (type, paper_id, user_id, detail) VALUES (?, ?, ?, ?)').run(
    type,
    paperId,
    userId,
    detail,
  );
}

// Order programmes appear in on the home page.
const PROGRAMME_ORDER = ['CS', 'IT', 'AI', 'CDS', 'EC', 'EE', 'ME', 'CV', 'CH', 'MT', 'MN'];

// Keeps courses and offerings in step with the curriculum file. Names, L-T-P and credits
// follow the curriculum; courses and offerings that admins added are left alone.
function syncCurriculum() {
  const file = path.join(config.root, 'server', 'curriculum-2025.json');
  const curriculum = JSON.parse(fs.readFileSync(file, 'utf8'));
  tx(() => {
    const branch = db.prepare(
      `INSERT INTO branches (code, name, position) VALUES (?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, position = excluded.position`,
    );
    for (const p of curriculum.programmes) branch.run(p.code, p.name, PROGRAMME_ORDER.indexOf(p.code) + 1);

    const subject = db.prepare(
      `INSERT INTO subjects (code, name, ltp, credits) VALUES (?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, ltp = excluded.ltp, credits = excluded.credits`,
    );
    for (const s of curriculum.subjects) subject.run(s.code, s.name, s.ltp, s.credits);

    db.exec("DELETE FROM offerings WHERE source = 'curriculum'");
    const offering = db.prepare(
      `INSERT OR IGNORE INTO offerings (subject_id, branch_code, semester, category, source)
       SELECT id, ?, ?, ?, 'curriculum' FROM subjects WHERE code = ?`,
    );
    for (const o of curriculum.offerings) offering.run(o.programme, o.semester, o.category, o.code);

    // Courses from the old hand-written catalog that aren't taught anywhere and have no papers.
    db.exec(`DELETE FROM subjects
              WHERE NOT EXISTS (SELECT 1 FROM offerings o WHERE o.subject_id = subjects.id)
                AND NOT EXISTS (SELECT 1 FROM papers p WHERE p.subject_id = subjects.id)`);
    db.exec(`DELETE FROM branches
              WHERE NOT EXISTS (SELECT 1 FROM offerings o WHERE o.branch_code = branches.code)`);
  });
}

function seedAdmin() {
  const { email, name, password } = config.admin;
  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (!exists) {
    db.prepare(
      `INSERT INTO users (email, name, password_hash, role, verified)
       VALUES (?, ?, ?, 'admin', 1)`,
    ).run(email, name, bcrypt.hashSync(password, 10));
    console.log(`Created admin account ${email}`);
  }
}

migrate();
syncCurriculum();
seedAdmin();
