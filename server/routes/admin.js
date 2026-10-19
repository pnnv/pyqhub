import { Router } from 'express';
import { branches, events, findPapers, papers, subjects, toId, users } from '../db.js';
import { HttpError, requireAdmin } from '../auth.js';
import { storage } from '../storage.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const notQuiz = { $ne: ['$exam_type', 'quiz'] };

async function getPaper(id) {
  const _id = toId(id);
  const [paper] = _id ? await findPapers({ _id }) : [];
  if (!paper) throw new HttpError(404, 'Paper not found.');
  return { ...paper, _id };
}

const sameLabel = (a, b) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

// Approved papers for the same course, year and exam: likely the same paper again.
// Quizzes have no fixed slot, so only one with the same name in the same year counts.
async function sameSlot(p) {
  if (p.exam_type === 'quiz' && !p.quiz_label) return [];
  const found = await papers
    .find(
      { subject: p.subject_code, exam_year: p.exam_year, exam_type: p.exam_type, status: 'approved' },
      { projection: { created_at: 1, downloads: 1, quiz_label: 1 } },
    )
    .toArray();
  return found
    .filter((d) => p.exam_type !== 'quiz' || sameLabel(d.quiz_label, p.quiz_label))
    .map((d) => ({ id: d._id.toHexString(), created_at: d.created_at.toISOString(), downloads: d.downloads }));
}

adminRouter.get('/queue', async (_req, res) => {
  const pending = await findPapers({ status: 'pending' }, { sort: { created_at: 1, _id: 1 } });
  res.json({ papers: await Promise.all(pending.map(async (p) => ({ ...p, existing: await sameSlot(p) }))) });
});

adminRouter.post('/papers/:id/approve', async (req, res) => {
  const paper = await getPaper(req.params.id);
  // Only a pending paper can be approved; checking in the update itself means two admins
  // approving at once can't both succeed.
  const done = await papers.updateOne(
    { _id: paper._id, status: 'pending' },
    { $set: { status: 'approved', reviewed_by: req.user._id, reviewed_at: new Date() }, $unset: { reject_reason: '' } },
  );
  if (!done.modifiedCount) throw new HttpError(409, 'This paper has already been reviewed.');

  const replace = (Array.isArray(req.body.replace) ? req.body.replace : []).map(toId).filter(Boolean);
  if (replace.length) {
    const candidates = await papers
      .find({ _id: { $in: replace }, status: 'approved', subject: paper.subject_code, exam_year: paper.exam_year, exam_type: paper.exam_type })
      .toArray();
    const ids = candidates.filter((d) => paper.exam_type !== 'quiz' || sameLabel(d.quiz_label, paper.quiz_label)).map((d) => d._id);
    if (ids.length) await papers.updateMany({ _id: { $in: ids } }, { $set: { status: 'superseded' } });
  }
  const { _id, ...updated } = await getPaper(req.params.id);
  res.json({ paper: updated });
});

adminRouter.post('/papers/:id/reject', async (req, res) => {
  const paper = await getPaper(req.params.id);
  const reason = String(req.body.reason ?? '').trim().slice(0, 300);
  if (!reason) throw new HttpError(400, 'Give the uploader a reason so they can fix it.');
  const done = await papers.updateOne(
    { _id: paper._id, status: 'pending' },
    { $set: { status: 'rejected', reject_reason: reason, reviewed_by: req.user._id, reviewed_at: new Date() } },
  );
  if (!done.modifiedCount) throw new HttpError(409, 'This paper has already been reviewed.');
  const { _id, ...updated } = await getPaper(req.params.id);
  res.json({ paper: updated });
});

adminRouter.get('/papers', async (req, res) => {
  const status = ['approved', 'rejected', 'superseded', 'pending'].includes(req.query.status)
    ? req.query.status
    : 'approved';
  const q = String(req.query.q ?? '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
  const match = { status, ...(q ? { subject: { $regex: `^${q}` } } : {}) };
  res.json({ papers: await findPapers(match, { sort: { created_at: -1, _id: -1 }, limit: 300 }) });
});

adminRouter.delete('/papers/:id', async (req, res) => {
  const { _id } = await getPaper(req.params.id);
  const { file_key } = await papers.findOneAndDelete({ _id });
  // The paper is gone from the site either way; a leftover file is only wasted space.
  await storage.remove(file_key).catch((err) => console.error(`Couldn't delete file ${file_key}: ${err.message}`));
  res.json({ ok: true });
});

adminRouter.get('/users', async (_req, res) => {
  const [list, uploads] = await Promise.all([
    users.find({}, { projection: { password_hash: 0, verify_token: 0 } }).sort({ created_at: -1, _id: -1 }).toArray(),
    papers.aggregate([{ $group: { _id: { user: '$uploader_id', status: '$status' }, n: { $sum: 1 } } }]).toArray(),
  ]);
  const count = (user, status) =>
    uploads.filter((u) => u._id.user?.equals(user._id) && (!status || u._id.status === status)).reduce((sum, u) => sum + u.n, 0);
  res.json({
    users: list.map((u) => ({
      id: u._id.toHexString(),
      email: u.email,
      name: u.name,
      role: u.role,
      verified: Boolean(u.verified),
      banned: Boolean(u.banned),
      created_at: u.created_at.toISOString(),
      uploads: count(u),
      approved: count(u, 'approved'),
      rejected: count(u, 'rejected'),
      pending: count(u, 'pending'),
    })),
  });
});

adminRouter.patch('/users/:id', async (req, res) => {
  const _id = toId(req.params.id);
  if (_id?.equals(req.user._id)) throw new HttpError(400, 'You cannot change your own role or access.');
  const changes = {};
  if (req.body.role !== undefined) {
    if (!['student', 'admin'].includes(req.body.role)) throw new HttpError(400, 'Unknown role.');
    changes.role = req.body.role;
  }
  if (req.body.banned !== undefined) changes.banned = Boolean(req.body.banned);
  const done = _id && (await users.updateOne({ _id }, { $set: changes }));
  if (!done?.matchedCount) throw new HttpError(404, 'User not found.');
  res.json({ ok: true });
});

// Adds a course to a programme. The course is created if it's new; an existing course
// (say, one shared with another programme) just gains the offering.
adminRouter.post('/subjects', async (req, res) => {
  const code = String(req.body.code ?? '').replace(/[\s-]+/g, '').toUpperCase();
  const name = String(req.body.name ?? '').trim();
  const branch = String(req.body.branch ?? '').toUpperCase();
  const semester = req.body.semester ? Number(req.body.semester) : null;
  if (!/^[A-Z]{2,4}\d{3}[A-Z]?$/.test(code)) throw new HttpError(400, 'Course code looks like CS301: letters then three digits.');
  if (!(await branches.findOne({ _id: branch }))) throw new HttpError(400, 'Choose a branch.');
  if (semester !== null && !(Number.isInteger(semester) && semester >= 1 && semester <= 8)) {
    throw new HttpError(400, 'Semester must be 1 to 8, or Elective.');
  }
  const existing = await subjects.findOne({ _id: code });
  if (!existing && !name) throw new HttpError(400, 'Enter the course name.');
  if (existing?.offerings.some((o) => o.branch === branch)) throw new HttpError(409, `${code} is already listed under ${branch}.`);

  const offering = { branch, semester, category: semester ? 'PC' : 'PSE', source: 'admin' };
  // Adds the offering only if that branch still isn't listed, so a double submit can't add it twice.
  const done = await subjects.updateOne(
    { _id: code, 'offerings.branch': { $ne: branch } },
    { $push: { offerings: offering }, $setOnInsert: { name, ltp: null, credits: null } },
    { upsert: !existing },
  );
  if (!done.matchedCount && !done.upsertedCount) throw new HttpError(409, `${code} is already listed under ${branch}.`);
  res.status(201).json({
    subject: { code, name: existing?.name ?? name, branch, semester, added: existing ? 'offering' : 'course' },
  });
});

adminRouter.get('/stats', async (_req, res) => {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 29);

  const [paperTotals, userCount, contributors, daily, topPapers, topSearches, byBranch, allSubjects, coveredSubjects] =
    await Promise.all([
      papers
        .aggregate([
          {
            $group: {
              _id: null,
              approved: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'approved'] }, notQuiz] }, 1, 0] } },
              quizzes: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'approved'] }, { $eq: ['$exam_type', 'quiz'] }] }, 1, 0] } },
              pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
              downloads: { $sum: '$downloads' },
              views: { $sum: '$views' },
            },
          },
        ])
        .toArray(),
      users.countDocuments(),
      papers.distinct('uploader_id', { status: 'approved' }),
      events
        .aggregate([
          { $match: { created_at: { $gte: since } } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
              downloads: { $sum: { $cond: [{ $eq: ['$type', 'download'] }, 1, 0] } },
              views: { $sum: { $cond: [{ $eq: ['$type', 'view'] }, 1, 0] } },
              uploads: { $sum: { $cond: [{ $eq: ['$type', 'upload'] }, 1, 0] } },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      findPapers({ status: 'approved' }, { sort: { downloads: -1, views: -1 }, limit: 8 }),
      events
        .aggregate([
          { $match: { type: 'search', created_at: { $gte: since } } },
          { $group: { _id: { $toLower: '$detail' }, count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 8 },
        ])
        .toArray(),
      // A paper counts towards every branch that teaches its course.
      papers
        .aggregate([
          { $match: { status: 'approved', exam_type: { $ne: 'quiz' } } },
          { $lookup: { from: 'subjects', localField: 'subject', foreignField: '_id', as: 's', pipeline: [{ $project: { b: '$offerings.branch' } }] } },
          { $unwind: '$s' },
          { $unwind: '$s.b' },
          { $group: { _id: '$s.b', papers: { $sum: 1 } } },
          { $sort: { papers: -1 } },
        ])
        .toArray(),
      subjects.find({ 'offerings.semester': { $type: 'number' } }, { projection: { name: 1, offerings: 1 } }).toArray(),
      papers.distinct('subject', { status: 'approved', exam_type: { $ne: 'quiz' } }),
    ]);

  // Core courses with no mid/end-sem paper yet, earliest semester first: where to ask seniors.
  const covered = new Set(coveredSubjects);
  const missingAll = allSubjects
    .filter((s) => !covered.has(s._id))
    .map((s) => ({
      code: s._id,
      name: s.name,
      semester: Math.min(...s.offerings.map((o) => o.semester).filter((n) => typeof n === 'number')),
    }))
    .sort((a, b) => a.semester - b.semester || a.code.localeCompare(b.code));

  const t = paperTotals[0] ?? {};
  res.json({
    totals: {
      approved: t.approved ?? 0,
      quizzes: t.quizzes ?? 0,
      pending: t.pending ?? 0,
      users: userCount,
      contributors: contributors.filter(Boolean).length,
      downloads: t.downloads ?? 0,
      views: t.views ?? 0,
    },
    daily: daily.map((d) => ({ day: d._id, downloads: d.downloads, views: d.views, uploads: d.uploads })),
    topPapers: topPapers.map(({ id, subject_code, subject_name, exam_year, exam_type, quiz_label, downloads, views }) => ({
      id, subject_code, subject_name, exam_year, exam_type, quiz_label, downloads, views,
    })),
    topSearches: topSearches.map((s) => ({ term: s._id, count: s.count })),
    byBranch: byBranch.map((b) => ({ branch: b._id, papers: b.papers })),
    missing: missingAll.slice(0, 12),
    missingCount: missingAll.length,
  });
});
