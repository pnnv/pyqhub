import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { db, logEvent } from '../db.js';
import { HttpError, requireUser, requireVerified } from '../auth.js';
import { storage } from '../storage.js';

export const papersRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
});

const EXAM_TYPES = new Set(['mid', 'end', 'quiz']);
const COURSES_PER_PAGE = 40;
const thisYear = () => new Date().getFullYear();

const paperSelect = `
  SELECT p.id, p.exam_year, p.exam_type, p.quiz_label, p.held_on, p.file_size, p.note, p.status,
         p.reject_reason, p.views, p.downloads, p.created_at, p.uploader_id,
         s.code AS subject_code, s.name AS subject_name, u.name AS uploader
    FROM papers p
    JOIN subjects s ON s.id = p.subject_id
    LEFT JOIN users u ON u.id = p.uploader_id`;

// Approved papers are public. Anything else is visible only to its uploader and admins.
function findVisiblePaper(id, user) {
  const paper = db.prepare(`${paperSelect} WHERE p.id = ?`).get(Number(id));
  const canSee =
    paper && (paper.status === 'approved' || user?.role === 'admin' || user?.id === paper.uploader_id);
  if (!canSee) throw new HttpError(404, 'This paper does not exist or is not available yet.');
  return paper;
}

papersRouter.get('/papers', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const where = [`p.status = 'approved'`];
  const params = [];

  if (q) {
    // "cs 301", "CS-301" and "cs301" all mean the same course code.
    const code = q.replace(/[\s-]+/g, '').toUpperCase();
    where.push(`(s.code LIKE ? OR s.name LIKE ?)`);
    params.push(`${code}%`, `%${q}%`);
  }
  if (req.query.branch) {
    where.push('EXISTS (SELECT 1 FROM offerings o WHERE o.subject_id = s.id AND o.branch_code = ?)');
    params.push(String(req.query.branch).toUpperCase());
  }
  if (req.query.year) {
    where.push('p.exam_year = ?');
    params.push(Number(req.query.year));
  }
  if (EXAM_TYPES.has(req.query.type)) {
    where.push('p.exam_type = ?');
    params.push(req.query.type);
  }

  // Results come a page of courses at a time, with every matching paper for those courses;
  // the totals are counted separately so they stay true however many pages there are.
  const filter = where.join(' AND ');
  const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
  const total = db
    .prepare(
      `SELECT COUNT(*) AS papers, COUNT(DISTINCT p.subject_id) AS courses
         FROM papers p JOIN subjects s ON s.id = p.subject_id WHERE ${filter}`,
    )
    .get(...params);
  const codes = db
    .prepare(
      `SELECT s.code FROM papers p JOIN subjects s ON s.id = p.subject_id WHERE ${filter}
        GROUP BY s.code ORDER BY s.code LIMIT ? OFFSET ?`,
    )
    .all(...params, COURSES_PER_PAGE, (page - 1) * COURSES_PER_PAGE)
    .map((r) => r.code);
  const papers = codes.length
    ? db
        .prepare(
          `${paperSelect} WHERE ${filter} AND s.code IN (${codes.map(() => '?').join(', ')})
           ORDER BY s.code, p.exam_year DESC, p.exam_type, p.held_on DESC`,
        )
        .all(...params, ...codes)
    : [];

  // For each matching course: every approved mid/end-sem paper from the last five years
  // (ignoring the year/exam filters), so the results can show which slots are covered and
  // which are missing. Quizzes have no fixed slots, so they're only counted.
  const since = thisYear() - 4;
  const slots = db.prepare(
    `SELECT p.id, p.exam_year, p.exam_type FROM papers p JOIN subjects s ON s.id = p.subject_id
      WHERE s.code = ? AND p.status = 'approved' AND p.exam_type <> 'quiz' AND p.exam_year >= ?
      ORDER BY p.exam_year DESC, p.exam_type`,
  );
  const totals = db.prepare(
    `SELECT SUM(p.exam_type <> 'quiz') AS papers, SUM(p.exam_type = 'quiz') AS quizzes
       FROM papers p JOIN subjects s ON s.id = p.subject_id
      WHERE s.code = ? AND p.status = 'approved'`,
  );
  const courses = [];
  for (const p of papers) {
    if (courses.at(-1)?.code === p.subject_code) continue;
    const total = totals.get(p.subject_code);
    courses.push({
      code: p.subject_code,
      name: p.subject_name,
      total: total.papers ?? 0,
      quizzes: total.quizzes ?? 0,
      slots: slots.all(p.subject_code, since),
    });
  }

  if (q) logEvent('search', { userId: req.user?.id, detail: q.slice(0, 100) });
  res.json({
    papers: papers.map(({ uploader_id, reject_reason, status, ...p }) => p),
    courses,
    total,
    page,
    perPage: COURSES_PER_PAGE,
    pages: Math.max(1, Math.ceil(total.courses / COURSES_PER_PAGE)),
  });
});

papersRouter.get('/papers/:id', (req, res) => {
  const paper = findVisiblePaper(req.params.id, req.user);
  res.json({ paper });
});

papersRouter.get('/papers/:id/file', (req, res) => {
  const paper = findVisiblePaper(req.params.id, req.user);
  const { file_key } = db.prepare('SELECT file_key FROM papers WHERE id = ?').get(paper.id);
  const download = req.query.download === '1';

  if (paper.status === 'approved') {
    db.prepare(`UPDATE papers SET ${download ? 'downloads' : 'views'} = ${download ? 'downloads' : 'views'} + 1 WHERE id = ?`).run(paper.id);
    logEvent(download ? 'download' : 'view', { paperId: paper.id, userId: req.user?.id });
  }

  const type =
    paper.exam_type === 'quiz'
      ? (paper.quiz_label || 'Quiz').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
      : paper.exam_type === 'mid' ? 'MidSem' : 'EndSem';
  const filename = `${paper.subject_code}_${type}_${paper.exam_year}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  const stream = storage.stream(file_key);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});

papersRouter.post('/papers', requireVerified, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'Attach the question paper as a PDF.');
  if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new HttpError(400, 'That file is not a PDF. Scan or export the paper as PDF and try again.');
  }

  const subject = db
    .prepare('SELECT id, code FROM subjects WHERE code = ?')
    .get(String(req.body.subject ?? '').replace(/[\s-]+/g, '').toUpperCase());
  if (!subject) throw new HttpError(400, 'Pick a course from the list.');

  const examYear = Number(req.body.exam_year);
  if (!Number.isInteger(examYear) || examYear < 2000 || examYear > thisYear()) {
    throw new HttpError(400, `Exam year must be between 2000 and ${thisYear()}.`);
  }
  const examType = String(req.body.exam_type);
  if (!EXAM_TYPES.has(examType)) throw new HttpError(400, 'Choose mid-sem, end-sem or quiz.');

  // Quizzes happen whenever the instructor decides, so they carry a name and date instead of a slot.
  let quizLabel = null;
  let heldOn = null;
  if (examType === 'quiz') {
    quizLabel = String(req.body.quiz_label ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) || null;
    heldOn = String(req.body.held_on ?? '').trim() || null;
    if (heldOn) {
      const date = new Date(`${heldOn}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(heldOn) || Number.isNaN(date.getTime())) {
        throw new HttpError(400, 'Enter the quiz date as a full date, or leave it empty.');
      }
      if (date.getUTCFullYear() !== examYear) {
        throw new HttpError(400, `The quiz date is in ${date.getUTCFullYear()} but the exam year is ${examYear}.`);
      }
      if (date > new Date()) throw new HttpError(400, 'The quiz date is in the future.');
    }
  }

  const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const dup = db
    .prepare(
      `SELECT p.id, p.status, s.code FROM papers p JOIN subjects s ON s.id = p.subject_id WHERE p.file_hash = ?`,
    )
    .get(hash);
  if (dup) {
    throw new HttpError(
      409,
      dup.status === 'rejected'
        ? 'This exact file was uploaded before and rejected.'
        : `This exact file is already on PYQ Hub under ${dup.code}.`,
    );
  }

  const key = await storage.save(file.buffer);
  const note = String(req.body.note ?? '').trim().slice(0, 200) || null;
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO papers (subject_id, exam_year, exam_type, quiz_label, held_on, file_key, file_hash,
                          file_size, original_name, note, uploader_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(subject.id, examYear, examType, quizLabel, heldOn, key, hash, file.size, file.originalname.slice(0, 200), note, req.user.id);

  logEvent('upload', { paperId: Number(lastInsertRowid), userId: req.user.id });
  res.status(201).json({ paper: findVisiblePaper(lastInsertRowid, req.user) });
});

papersRouter.get('/me/uploads', requireUser, (req, res) => {
  const papers = db
    .prepare(`${paperSelect} WHERE p.uploader_id = ? ORDER BY p.created_at DESC, p.id DESC`)
    .all(req.user.id);
  res.json({ papers });
});
