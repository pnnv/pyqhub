import { Router } from 'express';
import { db } from '../db.js';
import { HttpError } from '../auth.js';

export const catalogRouter = Router();

const approvedCount = `(SELECT COUNT(*) FROM papers p WHERE p.subject_id = s.id AND p.status = 'approved')`;

catalogRouter.get('/branches', (_req, res) => {
  const branches = db
    .prepare(
      `SELECT b.code, b.name,
              (SELECT COUNT(*) FROM subjects s WHERE s.branch_code = b.code) AS subjects,
              (SELECT COUNT(*) FROM papers p JOIN subjects s ON s.id = p.subject_id
                WHERE s.branch_code = b.code AND p.status = 'approved') AS papers
         FROM branches b ORDER BY b.rowid`,
    )
    .all();
  const totals = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM papers WHERE status = 'approved') AS papers,
              (SELECT COUNT(DISTINCT subject_id) FROM papers WHERE status = 'approved') AS subjects,
              (SELECT COUNT(*) FROM subjects WHERE branch_code IS NULL) AS common`,
    )
    .get();
  res.json({ branches, totals });
});

catalogRouter.get('/branches/:code', (req, res) => {
  const branch = db.prepare('SELECT code, name FROM branches WHERE code = ?').get(req.params.code.toUpperCase());
  if (!branch) throw new HttpError(404, 'No branch with that code.');
  const subjects = db
    .prepare(
      `SELECT s.code, s.name, s.year, s.branch_code AS branch, ${approvedCount} AS papers
         FROM subjects s
        WHERE s.branch_code = ? OR s.branch_code IS NULL
        ORDER BY s.year, s.code`,
    )
    .all(branch.code);
  res.json({ branch, subjects });
});

// Flat list for the upload form's course picker.
catalogRouter.get('/subjects', (_req, res) => {
  const subjects = db
    .prepare('SELECT code, name, year, branch_code AS branch FROM subjects ORDER BY code')
    .all();
  res.json({ subjects });
});

catalogRouter.get('/subjects/:code', (req, res) => {
  const subject = db
    .prepare(
      `SELECT s.id, s.code, s.name, s.year, s.branch_code AS branch, b.name AS branch_name
         FROM subjects s LEFT JOIN branches b ON b.code = s.branch_code
        WHERE s.code = ?`,
    )
    .get(req.params.code.toUpperCase());
  if (!subject) throw new HttpError(404, 'No course with that code.');
  const papers = db
    .prepare(
      `SELECT p.id, p.exam_year, p.exam_type, p.file_size, p.note, p.downloads, p.created_at,
              u.name AS uploader
         FROM papers p LEFT JOIN users u ON u.id = p.uploader_id
        WHERE p.subject_id = ? AND p.status = 'approved'
        ORDER BY p.exam_year DESC, p.exam_type`,
    )
    .all(subject.id);
  // Uploads awaiting review, so the course page can show the slot is taken.
  const pending = db
    .prepare(
      `SELECT p.exam_year, p.exam_type, p.created_at, u.name AS uploader
         FROM papers p LEFT JOIN users u ON u.id = p.uploader_id
        WHERE p.subject_id = ? AND p.status = 'pending'`,
    )
    .all(subject.id);
  delete subject.id;
  res.json({ subject, papers, pending });
});
