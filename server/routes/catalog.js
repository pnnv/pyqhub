import { Router } from 'express';
import { branches, countsBySubject, findPapers, papers, subjects } from '../db.js';
import { HttpError } from '../auth.js';

export const catalogRouter = Router();

const quiz = { $eq: ['$exam_type', 'quiz'] };
const notQuiz = { $ne: ['$exam_type', 'quiz'] };

catalogRouter.get('/branches', async (_req, res) => {
  const [list, courseCounts, paperCounts, totals, coursesWithPapers] = await Promise.all([
    branches.find().sort({ position: 1, _id: 1 }).toArray(),
    subjects.aggregate([{ $unwind: '$offerings' }, { $group: { _id: '$offerings.branch', n: { $sum: 1 } } }]).toArray(),
    // A paper counts towards every branch that teaches its course.
    papers
      .aggregate([
        { $match: { status: 'approved' } },
        { $lookup: { from: 'subjects', localField: 'subject', foreignField: '_id', as: 's', pipeline: [{ $project: { b: '$offerings.branch' } }] } },
        { $unwind: '$s' },
        { $unwind: '$s.b' },
        {
          $group: {
            _id: '$s.b',
            papers: { $sum: { $cond: [notQuiz, 1, 0] } },
            quizzes: { $sum: { $cond: [quiz, 1, 0] } },
          },
        },
      ])
      .toArray(),
    papers
      .aggregate([
        { $match: { status: 'approved' } },
        { $group: { _id: null, papers: { $sum: { $cond: [notQuiz, 1, 0] } }, quizzes: { $sum: { $cond: [quiz, 1, 0] } } } },
      ])
      .toArray(),
    papers.distinct('subject', { status: 'approved' }),
  ]);
  const courses = Object.fromEntries(courseCounts.map((c) => [c._id, c.n]));
  const counts = Object.fromEntries(paperCounts.map((c) => [c._id, c]));
  res.json({
    branches: list.map((b) => ({
      code: b._id,
      name: b.name,
      subjects: courses[b._id] ?? 0,
      papers: counts[b._id]?.papers ?? 0,
      quizzes: counts[b._id]?.quizzes ?? 0,
    })),
    totals: { papers: totals[0]?.papers ?? 0, quizzes: totals[0]?.quizzes ?? 0, subjects: coursesWithPapers.length },
  });
});

catalogRouter.get('/branches/:code', async (req, res) => {
  const branch = await branches.findOne({ _id: req.params.code.toUpperCase() });
  if (!branch) throw new HttpError(404, 'No branch with that code.');
  const list = await subjects.find({ 'offerings.branch': branch._id }).toArray();
  const counts = await countsBySubject(list.map((s) => s._id));
  const rows = list
    .map((s) => {
      const o = s.offerings.find((x) => x.branch === branch._id);
      return {
        code: s._id,
        name: s.name,
        credits: s.credits ?? null,
        semester: o.semester ?? null,
        category: o.category,
        papers: counts[s._id]?.papers ?? 0,
        quizzes: counts[s._id]?.quizzes ?? 0,
      };
    })
    // semesters in order, electives last
    .sort((a, b) => (a.semester ?? 99) - (b.semester ?? 99) || a.code.localeCompare(b.code));
  res.json({ branch: { code: branch._id, name: branch.name }, subjects: rows });
});

// Flat list for the course pickers.
catalogRouter.get('/subjects', async (_req, res) => {
  const list = await subjects.find({}, { projection: { name: 1 } }).sort({ _id: 1 }).toArray();
  res.json({ subjects: list.map((s) => ({ code: s._id, name: s.name })) });
});

catalogRouter.get('/subjects/:code', async (req, res) => {
  const subject = await subjects.findOne({ _id: req.params.code.replace(/[\s-]+/g, '').toUpperCase() });
  if (!subject) throw new HttpError(404, 'No course with that code.');
  const branchList = await branches.find({ _id: { $in: subject.offerings.map((o) => o.branch) } }).toArray();
  const branchById = Object.fromEntries(branchList.map((b) => [b._id, b]));
  const offerings = subject.offerings
    .filter((o) => branchById[o.branch])
    .map((o) => ({ branch: o.branch, branch_name: branchById[o.branch].name, semester: o.semester ?? null, category: o.category }))
    // core offerings first, then by the home-page order of branches
    .sort((a, b) => (a.semester === null) - (b.semester === null) || branchById[a.branch].position - branchById[b.branch].position);

  const [approved, pending] = await Promise.all([
    findPapers({ subject: subject._id, status: 'approved' }, { sort: { exam_year: -1, exam_type: 1, held_on: -1, created_at: -1 } }),
    // Uploads awaiting review, so the course page can show the slot is taken.
    findPapers({ subject: subject._id, status: 'pending' }),
  ]);
  const publicFields = ({ id, exam_year, exam_type, quiz_label, held_on, file_size, note, downloads, created_at, uploader }) =>
    ({ id, exam_year, exam_type, quiz_label, held_on, file_size, note, downloads, created_at, uploader });
  res.json({
    subject: { code: subject._id, name: subject.name, ltp: subject.ltp ?? null, credits: subject.credits ?? null },
    offerings,
    papers: approved.map(publicFields),
    pending: pending.map(({ exam_year, exam_type, quiz_label, held_on, created_at, uploader }) => ({
      exam_year,
      exam_type,
      quiz_label,
      held_on,
      created_at,
      uploader,
    })),
  });
});
