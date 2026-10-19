// Fills the database with demo users, papers (generated one-page PDFs) and 30 days of activity.
// Run once on an empty database: npm run seed:demo
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, tx } from './db.js';
import { storage } from './storage.js';

if (db.prepare('SELECT COUNT(*) AS n FROM papers').get().n > 0) {
  console.log('Papers already exist; skipping demo seed.');
  process.exit(0);
}

function makePdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const body = lines
    .map(([size, y, text, x = 72]) => `BT /F1 ${size} Tf ${x} ${y} Td (${esc(text)}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = objects.map((obj, i) => {
    const at = Buffer.byteLength(out);
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const latin1 = (text) => text.replace(/[^\x20-\x7e]/g, '-'); // the PDF's built-in font is Latin-1

// One-page sample paper. Odd-semester exams run Aug-Nov, even-semester ones Jan-Apr.
function paperPdf(subject, year, type, { copy = '', label = null, heldOn = null } = {}) {
  const odd = subject.semester % 2 === 1;
  const quiz = type === 'quiz';
  const end = type === 'end';
  const when = quiz
    ? `${label ?? 'Quiz'}${heldOn ? `, ${Number(heldOn.slice(8))} ${MONTHS[Number(heldOn.slice(5, 7)) - 1]} ${year}` : `, ${year}`}`
    : `${end ? 'End' : 'Mid'} Semester Examination, ${end ? (odd ? 'November' : 'April') : odd ? 'September' : 'February'} ${year}`;
  const marks = quiz ? 20 : end ? 100 : 30;
  const lines = [
    [9, 800, `DEMO PAPER - generated sample, not an actual examination paper${copy}`, 150],
    [14, 760, 'National Institute of Technology Karnataka, Surathkal', 120],
    [11, 738, latin1(when), quiz ? 250 : 190],
    [12, 710, latin1(`${subject.code}  ${subject.name}`)],
    [10, 692, `Time: ${quiz ? '30 minutes' : end ? '3 hours' : '90 minutes'}        Maximum marks: ${marks}`],
    [10, 674, 'Answer all questions. Assume missing data suitably.'],
  ];
  const qs = quiz ? 2 : end ? 5 : 3;
  for (let i = 0; i < qs; i++) {
    const y = 630 - i * 80;
    lines.push([11, y, latin1(`${i + 1}. (a) Explain a core concept from unit ${i + 1} of ${subject.name}.`)]);
    lines.push([11, y - 18, `    (b) Solve the worked problem stated in the question.`]);
    lines.push([10, y - 36, `[${marks / qs / 2} + ${marks / qs / 2} marks]`, 460]);
  }
  return makePdf(lines);
}

const students = [
  ['Ananya Rao', 'ananya.211cs107@nitk.edu.in'],
  ['Rohan Shetty', 'rohan.211ec145@nitk.edu.in'],
  ['Meghana K', 'meghana.221me032@nitk.edu.in'],
  ['Farhan Ali', 'farhan.221it019@nitk.edu.in'],
];
const hash = bcrypt.hashSync('student123', 10);
const userIds = students.map(([name, email]) => {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  return Number(
    db.prepare('INSERT INTO users (email, name, password_hash, verified) VALUES (?, ?, ?, 1)').run(email, name, hash)
      .lastInsertRowid,
  );
});

// Each course with the earliest semester any programme teaches it in (null for electives).
const subjects = db
  .prepare(
    `SELECT s.id, s.code, s.name, MIN(o.semester) AS semester
       FROM subjects s JOIN offerings o ON o.subject_id = s.id
      GROUP BY s.id`,
  )
  .all();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const insert = db.prepare(
  `INSERT INTO papers (subject_id, exam_year, exam_type, quiz_label, held_on, file_key, file_hash, file_size,
                       original_name, uploader_id, status, reject_reason, views, downloads, created_at, reviewed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`,
);

async function addPaper(subject, year, type, status, { reason = null, label = null, heldOn = null, uploader = pick(userIds) } = {}) {
  // Uploads awaiting review are a different scan of the paper, so their bytes differ.
  const pdf = paperPdf(subject, year, type, { copy: status === 'approved' ? '' : ' (second copy)', label, heldOn });
  const key = await storage.save(pdf);
  const age = `-${Math.floor(Math.random() * 60) + 1} days`;
  const downloads = status === 'approved' ? Math.floor(Math.random() * (type === 'quiz' ? 60 : 180)) : 0;
  const fileLabel = type === 'quiz' ? (label ?? 'quiz').replace(/\s+/g, '') : `${type}sem`;
  return Number(
    insert.run(
      subject.id, year, type, label, heldOn, key,
      crypto.createHash('sha256').update(pdf).digest('hex'),
      pdf.length, `${subject.code}_${fileLabel}_${year}.pdf`,
      uploader, status, reason,
      status === 'approved' ? downloads * 2 + Math.floor(Math.random() * 40) : 0,
      downloads, age, status === 'pending' ? '+0 days' : age,
    ).lastInsertRowid,
  );
}

// A plausible quiz date inside the course's semester, never after today.
function quizDate(subject, year, n) {
  const odd = (subject.semester ?? 1) % 2 === 1;
  const month = (odd ? 8 : 1) + n; // Quiz 1 in Aug/Jan, then a month apart
  const day = 5 + Math.floor(Math.random() * 20);
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return new Date(`${date}T00:00:00`) <= new Date() ? date : null;
}

const thisYear = new Date().getFullYear();
const approvedIds = [];
let quizCount = 0;
const always = new Set(['CS252', 'CS301', 'MA110', 'MA111']); // stable examples for docs and screenshots

for (const subject of subjects) {
  const core = subject.semester !== null;
  // Most core courses have papers; a few electives do. The rest show up as gaps.
  if (!always.has(subject.code) && !chance(core ? 0.6 : 0.08)) continue;
  for (let year = thisYear - 1; year >= thisYear - (2 + Math.floor(Math.random() * 3)); year--) {
    for (const type of ['end', 'mid']) {
      if (!always.has(subject.code) && chance(0.25)) continue;
      approvedIds.push(await addPaper(subject, year, type, 'approved'));
    }
  }
  // Quizzes: whenever the instructor ran them, so any number per year.
  if (!always.has(subject.code) && !chance(0.35)) continue;
  for (const year of [thisYear, thisYear - 1, thisYear - 2]) {
    const n = Math.floor(Math.random() * 3) + (always.has(subject.code) ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const heldOn = quizDate(subject, year, i);
      if (year === thisYear && !heldOn) continue; // hasn't happened yet
      approvedIds.push(await addPaper(subject, year, 'quiz', 'approved', { label: `Quiz ${i + 1}`, heldOn }));
      quizCount++;
    }
  }
}

const byCode = Object.fromEntries(subjects.map((s) => [s.code, s]));
const pending = [
  ['CS252', thisYear - 1, 'end'],
  ['MA111', thisYear - 1, 'end'],
  ['CS301', thisYear, 'quiz', { label: 'Quiz 4', heldOn: quizDate(byCode.CS301, thisYear, 2) }],
];
for (const [code, year, type, extra] of pending) await addPaper(byCode[code], year, type, 'pending', extra);
const rejectedOn = byCode.ME201 ?? subjects.find((s) => s.semester === 3);
await addPaper(rejectedOn, thisYear - 2, 'end', 'rejected', {
  reason: 'Pages 2 and 3 are missing. Re-upload the full paper.',
  uploader: userIds[0],
});
db.prepare("UPDATE papers SET reviewed_at = NULL WHERE status = 'pending'").run();

// Activity log for the dashboard chart.
const event = db.prepare(
  `INSERT INTO events (type, paper_id, user_id, detail, created_at)
   VALUES (?, ?, ?, ?, datetime('now', ?, ?))`,
);
const terms = ['cs252', 'operating systems', 'computer networks', 'ma111', 'cs301', 'dbms', 'thermodynamics', 'cs202', 'data structures'];
tx(() => {
  for (let day = 29; day >= 0; day--) {
    // Activity climbs toward exam week.
    const weight = 1 + (29 - day) / 10;
    const n = Math.floor((20 + Math.random() * 25) * weight);
    for (let i = 0; i < n; i++) {
      const type = chance(0.55) ? 'view' : chance(0.85) ? 'download' : 'search';
      event.run(
        type,
        type === 'search' ? null : pick(approvedIds),
        chance(0.5) ? pick(userIds) : null,
        type === 'search' ? pick(terms) : null,
        `-${day} days`,
        `+${Math.floor(Math.random() * 86400)} seconds`,
      );
    }
    if (chance(0.4)) event.run('upload', pick(approvedIds), pick(userIds), null, `-${day} days`, '+0 seconds');
  }
});

console.log(`Seeded ${approvedIds.length - quizCount} approved papers, ${quizCount} quizzes, ${pending.length} pending, 1 rejected.`);
console.log('Demo students sign in with password student123, e.g. ananya.211cs107@nitk.edu.in');
