import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { countsBySubject, findPapers, isDuplicateKey, logEvent, papers, subjects, toId } from '../db.js';
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

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Approved papers are public. Anything else is visible only to its uploader and admins.
async function findVisiblePaper(id, user) {
  const _id = toId(String(id));
  const [paper] = _id ? await findPapers({ _id }) : [];
  const canSee = paper && (paper.status === 'approved' || user?.role === 'admin' || user?.id === paper.uploader_id);
  if (!canSee) throw new HttpError(404, 'This paper does not exist or is not available yet.');
  return paper;
}

papersRouter.get('/papers', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const match = { status: 'approved' };

  // Course filter: "cs 301", "CS-301" and "cs301" all mean the same code; names match anywhere.
  if (q || req.query.branch) {
    const courseFilter = {};
    if (q) {
      const code = q.replace(/[\s-]+/g, '').toUpperCase();
      courseFilter.$or = [{ _id: { $regex: `^${escapeRegex(code)}` } }, { name: { $regex: escapeRegex(q), $options: 'i' } }];
    }
    if (req.query.branch) courseFilter['offerings.branch'] = String(req.query.branch).toUpperCase();
    match.subject = { $in: await subjects.distinct('_id', courseFilter) };
  }
  if (req.query.year) match.exam_year = Number(req.query.year);
  if (EXAM_TYPES.has(req.query.type)) match.exam_type = req.query.type;

  // Results come a page of courses at a time, with every matching paper for those courses;
  // the totals are counted separately so they stay true however many pages there are.
  const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
  const [totalRow, pageRows] = await Promise.all([
    papers
      .aggregate([
        { $match: match },
        { $group: { _id: '$subject', n: { $sum: 1 } } },
        { $group: { _id: null, papers: { $sum: '$n' }, courses: { $sum: 1 } } },
      ])
      .toArray(),
    papers
      .aggregate([
        { $match: match },
        { $group: { _id: '$subject' } },
        { $sort: { _id: 1 } },
        { $skip: (page - 1) * COURSES_PER_PAGE },
        { $limit: COURSES_PER_PAGE },
      ])
      .toArray(),
  ]);
  const total = { papers: totalRow[0]?.papers ?? 0, courses: totalRow[0]?.courses ?? 0 };
  const codes = pageRows.map((r) => r._id);

  const found = codes.length
    ? await findPapers({ ...match, subject: { $in: codes } }, { sort: { subject: 1, exam_year: -1, exam_type: 1, held_on: -1 } })
    : [];

  // For each course on the page: every approved mid/end-sem paper from the last five years
  // (ignoring the year/exam filters), so the results can show which slots are covered and
  // which are missing. Quizzes have no fixed slots, so they're only counted.
  const since = thisYear() - 4;
  const [slotDocs, counts] = await Promise.all([
    papers
      .find(
        { subject: { $in: codes }, status: 'approved', exam_type: { $ne: 'quiz' }, exam_year: { $gte: since } },
        { projection: { subject: 1, exam_year: 1, exam_type: 1 } },
      )
      .sort({ exam_year: -1, exam_type: 1 })
      .toArray(),
    countsBySubject(codes),
  ]);
  const courses = [];
  for (const p of found) {
    if (courses.at(-1)?.code === p.subject_code) continue;
    courses.push({
      code: p.subject_code,
      name: p.subject_name,
      total: counts[p.subject_code]?.papers ?? 0,
      quizzes: counts[p.subject_code]?.quizzes ?? 0,
      slots: slotDocs
        .filter((d) => d.subject === p.subject_code)
        .map((d) => ({ id: d._id.toHexString(), exam_year: d.exam_year, exam_type: d.exam_type })),
    });
  }

  if (q) logEvent('search', { userId: req.user?._id, detail: q.slice(0, 100) });
  res.json({
    papers: found.map(({ uploader_id, uploader_email, reject_reason, status, ...p }) => p),
    courses,
    total,
    page,
    perPage: COURSES_PER_PAGE,
    pages: Math.max(1, Math.ceil(total.courses / COURSES_PER_PAGE)),
  });
});

papersRouter.get('/papers/:id', async (req, res) => {
  const { uploader_email, ...paper } = await findVisiblePaper(req.params.id, req.user);
  res.json({ paper });
});

papersRouter.get('/papers/:id/file', async (req, res) => {
  const paper = await findVisiblePaper(req.params.id, req.user);
  const _id = toId(paper.id);
  const { file_key } = await papers.findOne({ _id }, { projection: { file_key: 1 } });
  const download = req.query.download === '1';

  if (paper.status === 'approved') {
    await papers.updateOne({ _id }, { $inc: { [download ? 'downloads' : 'views']: 1 } });
    logEvent(download ? 'download' : 'view', { paperId: _id, userId: req.user?._id });
  }

  const type =
    paper.exam_type === 'quiz'
      ? (paper.quiz_label || 'Quiz').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
      : paper.exam_type === 'mid' ? 'MidSem' : 'EndSem';
  const filename = `${paper.subject_code}_${type}_${paper.exam_year}.pdf`;
  const file = await storage.deliver(file_key, { filename, download });
  if (file.url) {
    // Bucket storage: a fresh signed link per request, so every view and download is counted above.
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, file.url);
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', file.disposition);
  res.setHeader('Cache-Control', 'private, max-age=300');
  file.stream.on('error', () => res.destroy());
  file.stream.pipe(res);
});

papersRouter.post('/papers', requireVerified, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'Attach the question paper as a PDF.');
  if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new HttpError(400, 'That file is not a PDF. Scan or export the paper as PDF and try again.');
  }

  const code = String(req.body.subject ?? '').replace(/[\s-]+/g, '').toUpperCase();
  const subject = await subjects.findOne({ _id: code }, { projection: { _id: 1 } });
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
  const duplicate = (dup) =>
    new HttpError(
      409,
      dup?.status === 'rejected'
        ? 'This exact file was uploaded before and rejected.'
        : `This exact file is already on PYQ Hub${dup ? ` under ${dup.subject}` : ''}.`,
    );
  const dup = await papers.findOne({ file_hash: hash }, { projection: { status: 1, subject: 1 } });
  if (dup) throw duplicate(dup);

  const key = await storage.save(file.buffer);
  const doc = {
    subject: code,
    exam_year: examYear,
    exam_type: examType,
    quiz_label: quizLabel,
    held_on: heldOn,
    file_key: key,
    file_hash: hash,
    file_size: file.size,
    original_name: file.originalname.slice(0, 200),
    note: String(req.body.note ?? '').trim().slice(0, 200) || null,
    uploader_id: req.user._id,
    status: 'pending',
    views: 0,
    downloads: 0,
    created_at: new Date(),
  };
  try {
    await papers.insertOne(doc);
  } catch (err) {
    // the same file sent twice at once: keep one, drop the stored copy of the other
    await storage.remove(key).catch(() => {});
    if (isDuplicateKey(err)) throw duplicate(null);
    throw err;
  }

  logEvent('upload', { paperId: doc._id, userId: req.user._id });
  res.status(201).json({ paper: await findVisiblePaper(doc._id.toHexString(), req.user) });
});

papersRouter.get('/me/uploads', requireUser, async (req, res) => {
  res.json({ papers: await findPapers({ uploader_id: req.user._id }, { sort: { created_at: -1, _id: -1 } }) });
});
