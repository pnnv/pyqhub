import { Router } from 'express';
import { db } from '../db.js';
import { HttpError } from '../auth.js';

export const catalogRouter = Router();

// Approved mid/end-sem papers and approved quizzes for course s.
const counts = `
  (SELECT COUNT(*) FROM papers p WHERE p.subject_id = s.id AND p.status = 'approved' AND p.exam_type <> 'quiz') AS papers,
  (SELECT COUNT(*) FROM papers p WHERE p.subject_id = s.id AND p.status = 'approved' AND p.exam_type = 'quiz') AS quizzes`;

catalogRouter.get('/branches', (_req, res) => {
  const branches = db
    .prepare(
      `SELECT b.code, b.name,
              (SELECT COUNT(*) FROM offerings o WHERE o.branch_code = b.code) AS subjects,
              (SELECT COUNT(*) FROM papers p JOIN offerings o ON o.subject_id = p.subject_id
                WHERE o.branch_code = b.code AND p.status = 'approved' AND p.exam_type <> 'quiz') AS papers,
              (SELECT COUNT(*) FROM papers p JOIN offerings o ON o.subject_id = p.subject_id
                WHERE o.branch_code = b.code AND p.status = 'approved' AND p.exam_type = 'quiz') AS quizzes
         FROM branches b ORDER BY b.position, b.code`,
    )
    .all();
  const totals = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM papers WHERE status = 'approved' AND exam_type <> 'quiz') AS papers,
              (SELECT COUNT(*) FROM papers WHERE status = 'approved' AND exam_type = 'quiz') AS quizzes,
              (SELECT COUNT(DISTINCT subject_id) FROM papers WHERE status = 'approved') AS subjects`,
    )
    .get();
  res.json({ branches, totals });
});

catalogRouter.get('/branches/:code', (req, res) => {
  const branch = db.prepare('SELECT code, name FROM branches WHERE code = ?').get(req.params.code.toUpperCase());
  if (!branch) throw new HttpError(404, 'No branch with that code.');
  const subjects = db
    .prepare(
      `SELECT s.code, s.name, s.credits, o.semester, o.category, ${counts}
         FROM offerings o JOIN subjects s ON s.id = o.subject_id
        WHERE o.branch_code = ?
        ORDER BY o.semester IS NULL, o.semester, s.code`,
    )
    .all(branch.code);
  res.json({ branch, subjects });
});

// Flat list for the course pickers.
catalogRouter.get('/subjects', (_req, res) => {
  const subjects = db.prepare('SELECT code, name FROM subjects ORDER BY code').all();
  res.json({ subjects });
});

catalogRouter.get('/subjects/:code', (req, res) => {
  const subject = db
    .prepare('SELECT id, code, name, ltp, credits FROM subjects WHERE code = ?')
    .get(req.params.code.replace(/[\s-]+/g, '').toUpperCase());
  if (!subject) throw new HttpError(404, 'No course with that code.');
  const offerings = db
    .prepare(
      `SELECT o.branch_code AS branch, b.name AS branch_name, o.semester, o.category
         FROM offerings o JOIN branches b ON b.code = o.branch_code
        WHERE o.subject_id = ?
        ORDER BY o.semester IS NULL, b.position`,
    )
    .all(subject.id);
  const papers = db
    .prepare(
      `SELECT p.id, p.exam_year, p.exam_type, p.quiz_label, p.held_on, p.file_size, p.note,
              p.downloads, p.created_at, u.name AS uploader
         FROM papers p LEFT JOIN users u ON u.id = p.uploader_id
        WHERE p.subject_id = ? AND p.status = 'approved'
        ORDER BY p.exam_year DESC, p.exam_type, p.held_on DESC, p.created_at DESC`,
    )
    .all(subject.id);
  // Uploads awaiting review, so the course page can show the slot is taken.
  const pending = db
    .prepare(
      `SELECT p.exam_year, p.exam_type, p.quiz_label, p.held_on, p.created_at, u.name AS uploader
         FROM papers p LEFT JOIN users u ON u.id = p.uploader_id
        WHERE p.subject_id = ? AND p.status = 'pending'`,
    )
    .all(subject.id);
  delete subject.id;
  res.json({ subject, offerings, papers, pending });
});
