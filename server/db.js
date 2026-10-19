import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { branches, subjects } from './catalog-seed.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'pyq.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
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

  CREATE TABLE IF NOT EXISTS branches (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  -- branch_code is NULL for first-year courses common to every branch
  CREATE TABLE IF NOT EXISTS subjects (
    id          INTEGER PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    branch_code TEXT REFERENCES branches(code),
    year        INTEGER NOT NULL CHECK (year BETWEEN 1 AND 4)
  );

  CREATE TABLE IF NOT EXISTS papers (
    id            INTEGER PRIMARY KEY,
    subject_id    INTEGER NOT NULL REFERENCES subjects(id),
    exam_year     INTEGER NOT NULL,
    exam_type     TEXT NOT NULL CHECK (exam_type IN ('mid', 'end')),
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
  );
  CREATE INDEX IF NOT EXISTS papers_subject ON papers(subject_id, status);
  CREATE INDEX IF NOT EXISTS papers_status ON papers(status, created_at);

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY,
    type       TEXT NOT NULL CHECK (type IN ('view', 'download', 'search', 'upload', 'signup')),
    paper_id   INTEGER REFERENCES papers(id) ON DELETE SET NULL,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    detail     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS events_type_time ON events(type, created_at);
`);

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

export function logEvent(type, { paperId = null, userId = null, detail = null } = {}) {
  db.prepare('INSERT INTO events (type, paper_id, user_id, detail) VALUES (?, ?, ?, ?)').run(
    type,
    paperId,
    userId,
    detail,
  );
}

function seed() {
  tx(() => {
    const addBranch = db.prepare('INSERT OR IGNORE INTO branches (code, name) VALUES (?, ?)');
    for (const b of branches) addBranch.run(b.code, b.name);

    const addSubject = db.prepare(
      'INSERT OR IGNORE INTO subjects (code, name, branch_code, year) VALUES (?, ?, ?, ?)',
    );
    for (const s of subjects) addSubject.run(s.code, s.name, s.branch, s.year);
  });

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

seed();
