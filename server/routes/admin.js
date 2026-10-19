import { Router } from 'express';
import { db, tx } from '../db.js';
import { HttpError, requireAdmin } from '../auth.js';
import { storage } from '../storage.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const paperSelect = `
  SELECT p.id, p.subject_id, p.exam_year, p.exam_type, p.quiz_label, p.held_on, p.file_size, p.original_name, p.note,
         p.status, p.reject_reason, p.views, p.downloads, p.created_at, p.reviewed_at,
         s.code AS subject_code, s.name AS subject_name, u.name AS uploader, u.email AS uploader_email
    FROM papers p
    JOIN subjects s ON s.id = p.subject_id
    LEFT JOIN users u ON u.id = p.uploader_id`;

const getPaper = (id) => {
  const paper = db.prepare(`${paperSelect} WHERE p.id = ?`).get(Number(id));
  if (!paper) throw new HttpError(404, 'Paper not found.');
  return paper;
};

adminRouter.get('/queue', (_req, res) => {
  const pending = db.prepare(`${paperSelect} WHERE p.status = 'pending' ORDER BY p.created_at, p.id`).all();
  // Approved papers for the same course, year and exam: likely the same paper again.
  // Quizzes have no fixed slot, so only one with the same name in the same year counts.
  const sameSlot = db.prepare(
    `SELECT id, created_at, downloads FROM papers
      WHERE subject_id = ? AND exam_year = ? AND exam_type = ? AND status = 'approved'`,
  );
  const sameQuiz = db.prepare(
    `SELECT id, created_at, downloads FROM papers
      WHERE subject_id = ? AND exam_year = ? AND exam_type = 'quiz' AND status = 'approved'
        AND lower(quiz_label) = lower(?)`,
  );
  const existing = (p) =>
    p.exam_type !== 'quiz'
      ? sameSlot.all(p.subject_id, p.exam_year, p.exam_type)
      : p.quiz_label ? sameQuiz.all(p.subject_id, p.exam_year, p.quiz_label) : [];
  res.json({ papers: pending.map((p) => ({ ...p, existing: existing(p) })) });
});

adminRouter.post('/papers/:id/approve', (req, res) => {
  const paper = getPaper(req.params.id);
  if (paper.status !== 'pending') throw new HttpError(409, 'This paper has already been reviewed.');
  const replaceIds = (Array.isArray(req.body.replace) ? req.body.replace : []).map(Number);

  tx(() => {
    db.prepare(
      `UPDATE papers SET status = 'approved', reject_reason = NULL, reviewed_by = ?, reviewed_at = datetime('now')
        WHERE id = ?`,
    ).run(req.user.id, paper.id);
    const supersede = db.prepare(
      `UPDATE papers SET status = 'superseded' WHERE id = ? AND status = 'approved'
          AND subject_id = ? AND exam_year = ? AND exam_type = ?
          AND (exam_type <> 'quiz' OR lower(quiz_label) = lower(?))`,
    );
    for (const id of replaceIds) {
      supersede.run(id, paper.subject_id, paper.exam_year, paper.exam_type, paper.quiz_label ?? '');
    }
  });
  res.json({ paper: getPaper(paper.id) });
});

adminRouter.post('/papers/:id/reject', (req, res) => {
  const paper = getPaper(req.params.id);
  if (paper.status !== 'pending') throw new HttpError(409, 'This paper has already been reviewed.');
  const reason = String(req.body.reason ?? '').trim().slice(0, 300);
  if (!reason) throw new HttpError(400, 'Give the uploader a reason so they can fix it.');
  db.prepare(
    `UPDATE papers SET status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = datetime('now')
      WHERE id = ?`,
  ).run(reason, req.user.id, paper.id);
  res.json({ paper: getPaper(paper.id) });
});

adminRouter.get('/papers', (req, res) => {
  const status = ['approved', 'rejected', 'superseded', 'pending'].includes(req.query.status)
    ? req.query.status
    : 'approved';
  const q = String(req.query.q ?? '').replace(/[\s-]+/g, '').toUpperCase();
  const papers = db
    .prepare(
      `${paperSelect} WHERE p.status = ? AND (? = '' OR s.code LIKE ?)
       ORDER BY p.created_at DESC, p.id DESC LIMIT 300`,
    )
    .all(status, q, `${q}%`);
  res.json({ papers });
});

adminRouter.delete('/papers/:id', async (req, res) => {
  const paper = getPaper(req.params.id);
  const { file_key } = db.prepare('SELECT file_key FROM papers WHERE id = ?').get(paper.id);
  db.prepare('DELETE FROM papers WHERE id = ?').run(paper.id);
  await storage.remove(file_key);
  res.json({ ok: true });
});

adminRouter.get('/users', (_req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.verified, u.banned, u.created_at,
              (SELECT COUNT(*) FROM papers p WHERE p.uploader_id = u.id) AS uploads,
              (SELECT COUNT(*) FROM papers p WHERE p.uploader_id = u.id AND p.status = 'approved') AS approved,
              (SELECT COUNT(*) FROM papers p WHERE p.uploader_id = u.id AND p.status = 'rejected') AS rejected,
              (SELECT COUNT(*) FROM papers p WHERE p.uploader_id = u.id AND p.status = 'pending') AS pending
         FROM users u ORDER BY u.created_at DESC, u.id DESC`,
    )
    .all();
  res.json({ users });
});

adminRouter.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'You cannot change your own role or access.');
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) throw new HttpError(404, 'User not found.');
  if (req.body.role !== undefined) {
    if (!['student', 'admin'].includes(req.body.role)) throw new HttpError(400, 'Unknown role.');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, id);
  }
  if (req.body.banned !== undefined) {
    db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(req.body.banned ? 1 : 0, id);
  }
  res.json({ ok: true });
});

// Adds a course to a programme. The course is created if it's new; an existing course
// (say, one shared with another programme) just gains the offering.
adminRouter.post('/subjects', (req, res) => {
  const code = String(req.body.code ?? '').replace(/[\s-]+/g, '').toUpperCase();
  const name = String(req.body.name ?? '').trim();
  const branch = String(req.body.branch ?? '').toUpperCase();
  const semester = req.body.semester ? Number(req.body.semester) : null;
  if (!/^[A-Z]{2,4}\d{3}[A-Z]?$/.test(code)) throw new HttpError(400, 'Course code looks like CS301: letters then three digits.');
  if (!db.prepare('SELECT 1 FROM branches WHERE code = ?').get(branch)) throw new HttpError(400, 'Choose a branch.');
  if (semester !== null && !(Number.isInteger(semester) && semester >= 1 && semester <= 8)) {
    throw new HttpError(400, 'Semester must be 1 to 8, or Elective.');
  }
  const existing = db.prepare('SELECT id, name FROM subjects WHERE code = ?').get(code);
  if (!existing && !name) throw new HttpError(400, 'Enter the course name.');
  if (existing && db.prepare('SELECT 1 FROM offerings WHERE subject_id = ? AND branch_code = ?').get(existing.id, branch)) {
    throw new HttpError(409, `${code} is already listed under ${branch}.`);
  }
  const subject = tx(() => {
    const id = existing?.id ?? Number(db.prepare('INSERT INTO subjects (code, name) VALUES (?, ?)').run(code, name).lastInsertRowid);
    db.prepare(
      `INSERT INTO offerings (subject_id, branch_code, semester, category, source) VALUES (?, ?, ?, ?, 'admin')`,
    ).run(id, branch, semester, semester ? 'PC' : 'PSE');
    return { code, name: existing?.name ?? name, branch, semester, added: existing ? 'offering' : 'course' };
  });
  res.status(201).json({ subject });
});

adminRouter.get('/stats', (_req, res) => {
  const totals = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM papers WHERE status = 'approved' AND exam_type <> 'quiz') AS approved,
              (SELECT COUNT(*) FROM papers WHERE status = 'approved' AND exam_type = 'quiz') AS quizzes,
              (SELECT COUNT(*) FROM papers WHERE status = 'pending') AS pending,
              (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(DISTINCT uploader_id) FROM papers WHERE status = 'approved') AS contributors,
              (SELECT COALESCE(SUM(downloads), 0) FROM papers) AS downloads,
              (SELECT COALESCE(SUM(views), 0) FROM papers) AS views`,
    )
    .get();

  const daily = db
    .prepare(
      `SELECT date(created_at) AS day,
              SUM(type = 'download') AS downloads, SUM(type = 'view') AS views, SUM(type = 'upload') AS uploads
         FROM events
        WHERE created_at >= date('now', '-29 days')
        GROUP BY day ORDER BY day`,
    )
    .all();

  const topPapers = db
    .prepare(
      `SELECT p.id, s.code AS subject_code, s.name AS subject_name, p.exam_year, p.exam_type, p.quiz_label,
              p.downloads, p.views
         FROM papers p JOIN subjects s ON s.id = p.subject_id
        WHERE p.status = 'approved' ORDER BY p.downloads DESC, p.views DESC LIMIT 8`,
    )
    .all();

  const topSearches = db
    .prepare(
      `SELECT lower(detail) AS term, COUNT(*) AS count FROM events
        WHERE type = 'search' AND created_at >= date('now', '-29 days')
        GROUP BY term ORDER BY count DESC LIMIT 8`,
    )
    .all();

  // A paper counts towards every branch that teaches its course.
  const byBranch = db
    .prepare(
      `SELECT o.branch_code AS branch, COUNT(*) AS papers
         FROM papers p JOIN offerings o ON o.subject_id = p.subject_id
        WHERE p.status = 'approved' AND p.exam_type <> 'quiz'
        GROUP BY o.branch_code ORDER BY papers DESC`,
    )
    .all();

  // Core courses with no mid/end-sem paper yet, earliest semester first: where to ask seniors.
  const noPapers = `
    FROM subjects s
   WHERE EXISTS (SELECT 1 FROM offerings o WHERE o.subject_id = s.id AND o.semester IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM papers p WHERE p.subject_id = s.id AND p.status = 'approved' AND p.exam_type <> 'quiz')`;
  const missingCount = db.prepare(`SELECT COUNT(*) AS n ${noPapers}`).get().n;
  const missing = db
    .prepare(
      `SELECT s.code, s.name,
              (SELECT MIN(o.semester) FROM offerings o WHERE o.subject_id = s.id) AS semester
         ${noPapers}
        ORDER BY semester, s.code LIMIT 12`,
    )
    .all();

  res.json({ totals, daily, topPapers, topSearches, byBranch, missing, missingCount });
});
