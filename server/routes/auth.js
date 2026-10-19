import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { isDuplicateKey, logEvent, users } from '../db.js';
import { HttpError, clearSession, publicUser, requireUser, setSession, withId } from '../auth.js';
import { mailEnabled, sendVerificationEmail } from '../mail.js';

export const authRouter = Router();

// Small in-memory limiter: 20 attempts per IP per 15 minutes on sign-in/sign-up.
const attempts = new Map();
function limit(req, _res, next) {
  const now = Date.now();
  const entry = attempts.get(req.ip);
  if (!entry || now - entry.start > 15 * 60 * 1000) {
    attempts.set(req.ip, { start: now, count: 1 });
    return next();
  }
  if (++entry.count > 20) return next(new HttpError(429, 'Too many attempts. Try again in 15 minutes.'));
  next();
}

const newToken = () => crypto.randomBytes(24).toString('hex');
const verifyLink = (token) => `${config.baseUrl}/verify/${token}`;

async function sendVerification(user) {
  const link = verifyLink(user.verify_token);
  await sendVerificationEmail(user.email, user.name, link);
  // Without SMTP there is no inbox to check, so hand the link back in development.
  return !mailEnabled && !config.isProd ? { devVerifyLink: link } : {};
}

authRouter.post('/signup', limit, async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const password = String(req.body.password ?? '');

  if (!name) throw new HttpError(400, 'Enter your name.');
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || !email.endsWith(`@${config.emailDomain}`)) {
    throw new HttpError(400, `Use your college email ending in @${config.emailDomain}.`);
  }
  if (password.length < 8) throw new HttpError(400, 'Password needs at least 8 characters.');
  const exists = new HttpError(409, 'An account with this email already exists. Sign in instead.');
  if (await users.findOne({ email }, { projection: { _id: 1 } })) throw exists;

  const doc = {
    email,
    name,
    password_hash: await bcrypt.hash(password, 10),
    role: 'student',
    verified: false,
    verify_token: newToken(),
    banned: false,
    created_at: new Date(),
  };
  try {
    await users.insertOne(doc);
  } catch (err) {
    throw isDuplicateKey(err) ? exists : err; // two sign-ups with the same email at once
  }
  const user = withId(doc);

  logEvent('signup', { userId: doc._id });
  setSession(res, user);
  res.status(201).json({ user: publicUser(user), ...(await sendVerification(user)) });
});

authRouter.post('/login', limit, async (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const user = withId(await users.findOne({ email }));
  const ok = user && (await bcrypt.compare(String(req.body.password ?? ''), user.password_hash));
  if (!ok) throw new HttpError(401, 'Email or password is incorrect.');
  if (user.banned) throw new HttpError(403, 'This account has been suspended. Contact an admin.');
  setSession(res, user);
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) ?? null, emailDomain: config.emailDomain });
});

authRouter.post('/verify', async (req, res) => {
  const token = String(req.body.token ?? '');
  const user =
    token &&
    (await users.findOneAndUpdate(
      { verify_token: token },
      { $set: { verified: true }, $unset: { verify_token: '' } },
      { returnDocument: 'after' },
    ));
  if (!user) throw new HttpError(400, 'This confirmation link is invalid or was already used.');
  setSession(res, withId(user));
  res.json({ user: publicUser(withId(user)) });
});

authRouter.post('/resend', requireUser, limit, async (req, res) => {
  if (req.user.verified) return res.json({ ok: true });
  const token = newToken();
  await users.updateOne({ _id: req.user._id }, { $set: { verify_token: token } });
  res.json({ ok: true, ...(await sendVerification({ ...req.user, verify_token: token })) });
});
