// MongoDB: accounts, the course catalog and the paper records. PDFs themselves live in
// storage.js; a paper document only holds the file's key.
//
// Collections
//   users     { _id, email, name, password_hash, role, verified, verify_token, banned, created_at }
//   branches  { _id: 'CS', name, position }
//   subjects  { _id: 'CS301', name, ltp, credits,
//               offerings: [{ branch, semester (1-8, null for electives), category, source }] }
//   papers    { _id, subject: 'CS301', exam_year, exam_type ('mid' | 'end' | 'quiz'), quiz_label,
//               held_on ('YYYY-MM-DD'), file_key, file_hash, file_size, original_name, note,
//               uploader_id, status, reject_reason, reviewed_by, reviewed_at, views, downloads, created_at }
//   events    { type, paper_id, user_id, detail, created_at }   activity log for the dashboard
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { MongoClient, ObjectId } from 'mongodb';
import { config } from './config.js';

export const client = new MongoClient(config.mongoUri);
// The database named in the connection string ("…mongodb.net/pyqhub?…"), or "pyqhub" when it names none.
const dbName = config.mongoUri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/)?.[1] || 'pyqhub';
export const db = client.db(decodeURIComponent(dbName));
export const users = db.collection('users');
export const branches = db.collection('branches');
export const subjects = db.collection('subjects');
export const papers = db.collection('papers');
export const events = db.collection('events');

// "6531…" from a URL or form into an ObjectId, or null when it can't be one.
export const toId = (value) => (typeof value === 'string' && ObjectId.isValid(value) && value.length === 24 ? new ObjectId(value) : null);

export const isDuplicateKey = (err) => err?.code === 11000;

export function logEvent(type, { paperId = null, userId = null, detail = null } = {}) {
  // Stats only: never let a failed log entry break the request that caused it.
  events
    .insertOne({ type, paper_id: paperId, user_id: userId, detail, created_at: new Date() })
    .catch((err) => console.error(`Couldn't log ${type} event: ${err.message}`));
}

// ---------- shaping paper documents for the API ----------

// Course name and uploader joined onto paper documents.
export const withNames = [
  { $lookup: { from: 'subjects', localField: 'subject', foreignField: '_id', as: 'subject_doc', pipeline: [{ $project: { name: 1 } }] } },
  { $lookup: { from: 'users', localField: 'uploader_id', foreignField: '_id', as: 'uploader_doc', pipeline: [{ $project: { name: 1, email: 1 } }] } },
];

export function paperOut(p) {
  return {
    id: p._id.toHexString(),
    subject_code: p.subject,
    subject_name: p.subject_doc?.[0]?.name ?? p.subject,
    exam_year: p.exam_year,
    exam_type: p.exam_type,
    quiz_label: p.quiz_label ?? null,
    held_on: p.held_on ?? null,
    file_size: p.file_size,
    original_name: p.original_name ?? null,
    note: p.note ?? null,
    status: p.status,
    reject_reason: p.reject_reason ?? null,
    views: p.views ?? 0,
    downloads: p.downloads ?? 0,
    created_at: p.created_at?.toISOString(),
    reviewed_at: p.reviewed_at?.toISOString() ?? null,
    uploader_id: p.uploader_id?.toHexString() ?? null,
    uploader: p.uploader_doc?.[0]?.name ?? null,
    uploader_email: p.uploader_doc?.[0]?.email ?? null,
  };
}

// Papers matching `match`, with names, shaped for the API.
export async function findPapers(match, { sort = { created_at: -1 }, limit = 0 } = {}) {
  const pipeline = [{ $match: match }, { $sort: sort }, ...(limit ? [{ $limit: limit }] : []), ...withNames];
  return (await papers.aggregate(pipeline).toArray()).map(paperOut);
}

// { CS301: { papers: 6, quizzes: 3 }, ... } counting approved papers of the given courses.
export async function countsBySubject(codes) {
  const rows = await papers
    .aggregate([
      { $match: { status: 'approved', ...(codes ? { subject: { $in: codes } } : {}) } },
      {
        $group: {
          _id: '$subject',
          papers: { $sum: { $cond: [{ $ne: ['$exam_type', 'quiz'] }, 1, 0] } },
          quizzes: { $sum: { $cond: [{ $eq: ['$exam_type', 'quiz'] }, 1, 0] } },
        },
      },
    ])
    .toArray();
  return Object.fromEntries(rows.map((r) => [r._id, { papers: r.papers, quizzes: r.quizzes }]));
}

// ---------- startup ----------

async function ensureIndexes() {
  await Promise.all([
    users.createIndex({ email: 1 }, { unique: true }),
    users.createIndex({ verify_token: 1 }, { sparse: true }),
    subjects.createIndex({ 'offerings.branch': 1 }),
    papers.createIndex({ file_hash: 1 }, { unique: true }),
    papers.createIndex({ subject: 1, status: 1, exam_year: -1 }),
    papers.createIndex({ status: 1, created_at: 1 }),
    papers.createIndex({ uploader_id: 1, created_at: -1 }),
    events.createIndex({ type: 1, created_at: 1 }),
  ]);
}

// Order programmes appear in on the home page.
const PROGRAMME_ORDER = ['CS', 'IT', 'AI', 'CDS', 'EC', 'EE', 'ME', 'CV', 'CH', 'MT', 'MN'];

// Keeps courses and offerings in step with the curriculum file. Names, L-T-P and credits
// follow the curriculum; courses and offerings that admins added are left alone.
async function syncCurriculum() {
  const file = path.join(config.root, 'server', 'curriculum-2025.json');
  const curriculum = JSON.parse(fs.readFileSync(file, 'utf8'));

  await branches.bulkWrite(
    curriculum.programmes.map((p) => ({
      updateOne: {
        filter: { _id: p.code },
        update: { $set: { name: p.name, position: PROGRAMME_ORDER.indexOf(p.code) + 1 } },
        upsert: true,
      },
    })),
  );

  const offeringsByCode = new Map();
  for (const o of curriculum.offerings) {
    if (!offeringsByCode.has(o.code)) offeringsByCode.set(o.code, []);
    offeringsByCode.get(o.code).push({ branch: o.programme, semester: o.semester, category: o.category, source: 'curriculum' });
  }
  const current = new Map((await subjects.find({}, { projection: { offerings: 1 } }).toArray()).map((s) => [s._id, s]));
  const listed = new Set(curriculum.subjects.map((s) => s.code));

  const ops = curriculum.subjects.map((s) => {
    const fromCurriculum = offeringsByCode.get(s.code) ?? [];
    const branchesListed = new Set(fromCurriculum.map((o) => o.branch));
    const keptByAdmins = (current.get(s.code)?.offerings ?? []).filter((o) => o.source === 'admin' && !branchesListed.has(o.branch));
    return {
      updateOne: {
        filter: { _id: s.code },
        update: { $set: { name: s.name, ltp: s.ltp, credits: s.credits, offerings: [...fromCurriculum, ...keptByAdmins] } },
        upsert: true,
      },
    };
  });
  // Courses no longer in the curriculum keep only what admins added.
  for (const [code, s] of current) {
    if (listed.has(code)) continue;
    ops.push({ updateOne: { filter: { _id: code }, update: { $set: { offerings: (s.offerings ?? []).filter((o) => o.source === 'admin') } } } });
  }
  await subjects.bulkWrite(ops);

  // Courses taught nowhere and with no papers, and programmes with no courses, go.
  const withPapers = await papers.distinct('subject');
  await subjects.deleteMany({ offerings: { $size: 0 }, _id: { $nin: withPapers } });
  const taught = await subjects.distinct('offerings.branch');
  await branches.deleteMany({ _id: { $nin: taught } });
}

async function seedAdmin() {
  const { email, name, password } = config.admin;
  const result = await users.updateOne(
    { email },
    {
      $setOnInsert: {
        email,
        name,
        password_hash: bcrypt.hashSync(password, 10),
        role: 'admin',
        verified: true,
        banned: false,
        created_at: new Date(),
      },
    },
    { upsert: true },
  );
  if (result.upsertedCount) console.log(`Created admin account ${email}`);
}

export async function connectDb() {
  await client.connect();
  await ensureIndexes();
  await syncCurriculum();
  await seedAdmin();
}
