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

function paperPdf(subject, year, type, copy = '') {
  const end = type === 'end';
  const month = end ? (subject.year % 2 ? 'November' : 'April') : (subject.year % 2 ? 'September' : 'February');
  const marks = end ? 100 : 30;
  const lines = [
    [9, 800, `DEMO PAPER - generated sample, not an actual examination paper${copy}`, 150],
    [14, 760, 'National Institute of Technology Karnataka, Surathkal', 120],
    [11, 738, `${end ? 'End' : 'Mid'} Semester Examination, ${month} ${year}`, 190],
    [12, 710, `${subject.code}  ${subject.name}`],
    [10, 692, `Time: ${end ? '3 hours' : '90 minutes'}        Maximum marks: ${marks}`],
    [10, 674, 'Answer all questions. Assume missing data suitably.'],
  ];
  const qs = end ? 5 : 3;
  for (let i = 0; i < qs; i++) {
    const y = 630 - i * 80;
    lines.push([11, y, `${i + 1}. (a) Explain a core concept from unit ${i + 1} of ${subject.name}.`]);
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

const subjects = db.prepare('SELECT id, code, name, year FROM subjects').all();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const insert = db.prepare(
  `INSERT INTO papers (subject_id, exam_year, exam_type, file_key, file_hash, file_size, original_name,
                       uploader_id, status, reject_reason, views, downloads, created_at, reviewed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`,
);

async function addPaper(subject, year, type, status, reason = null) {
  // Uploads awaiting review are a different scan of the paper, so their bytes differ.
  const pdf = paperPdf(subject, year, type, status === 'approved' ? '' : ' (second copy)');
  const key = await storage.save(pdf);
  const age = `-${Math.floor(Math.random() * 60) + 1} days`;
  const downloads = status === 'approved' ? Math.floor(Math.random() * 180) : 0;
  return Number(
    insert.run(
      subject.id, year, type, key,
      crypto.createHash('sha256').update(pdf).digest('hex'),
      pdf.length, `${subject.code}_${type}sem_${year}.pdf`,
      pick(userIds), status, reason,
      status === 'approved' ? downloads * 2 + Math.floor(Math.random() * 40) : 0,
      downloads, age, status === 'pending' ? '+0 days' : age,
    ).lastInsertRowid,
  );
}

// Roughly two thirds of courses get papers; the rest show up as gaps on the dashboard.
const approvedIds = [];
for (const subject of subjects) {
  if (Math.random() < 0.33) continue;
  for (let year = 2025; year >= 2025 - (2 + Math.floor(Math.random() * 3)); year--) {
    for (const type of ['end', 'mid']) {
      if (Math.random() < 0.25) continue;
      approvedIds.push(await addPaper(subject, year, type, 'approved'));
    }
  }
}

const byCode = Object.fromEntries(subjects.map((s) => [s.code, s]));
await addPaper(byCode.CS301, 2025, 'end', 'pending');
await addPaper(byCode.EC250, 2024, 'mid', 'pending');
await addPaper(byCode.MA111, 2025, 'end', 'pending');
await addPaper(byCode.ME250, 2023, 'end', 'rejected', 'Pages 2 and 3 are missing. Re-upload the full paper.');
db.prepare("UPDATE papers SET reviewed_at = NULL WHERE status = 'pending'").run();

// Activity log for the dashboard chart.
const event = db.prepare(
  `INSERT INTO events (type, paper_id, user_id, detail, created_at)
   VALUES (?, ?, ?, ?, datetime('now', ?, ?))`,
);
const terms = ['cs301', 'operating systems', 'dbms', 'ma111', 'signals', 'ec250', 'thermo', 'cs201', 'dsa'];
tx(() => {
  for (let day = 29; day >= 0; day--) {
    // Activity climbs toward exam week.
    const weight = 1 + (29 - day) / 10;
    const n = Math.floor((20 + Math.random() * 25) * weight);
    for (let i = 0; i < n; i++) {
      const type = Math.random() < 0.55 ? 'view' : Math.random() < 0.85 ? 'download' : 'search';
      event.run(
        type,
        type === 'search' ? null : pick(approvedIds),
        Math.random() < 0.5 ? pick(userIds) : null,
        type === 'search' ? pick(terms) : null,
        `-${day} days`,
        `+${Math.floor(Math.random() * 86400)} seconds`,
      );
    }
    if (Math.random() < 0.4) event.run('upload', pick(approvedIds), pick(userIds), null, `-${day} days`, '+0 seconds');
  }
});

console.log(`Seeded ${approvedIds.length} approved papers, 3 pending, 1 rejected.`);
console.log('Demo students sign in with password student123, e.g. ananya.211cs107@nitk.edu.in');
