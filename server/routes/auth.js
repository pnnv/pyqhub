import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { db, logEvent } from '../db.js';
import { HttpError, clearSession, publicUser, requireUser, setSession } from '../auth.js';
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
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
  }

  const token = newToken();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (email, name, password_hash, verify_token) VALUES (?, ?, ?, ?)')
    .run(email, name, await bcrypt.hash(password, 10), token);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);

  logEvent('signup', { userId: user.id });
  setSession(res, user);
  res.status(201).json({ user: publicUser(user), ...(await sendVerification(user)) });
});

authRouter.post('/login', limit, async (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
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

authRouter.post('/verify', (req, res) => {
  const token = String(req.body.token ?? '');
  const user = token && db.prepare('SELECT * FROM users WHERE verify_token = ?').get(token);
  if (!user) throw new HttpError(400, 'This confirmation link is invalid or was already used.');
  db.prepare('UPDATE users SET verified = 1, verify_token = NULL WHERE id = ?').run(user.id);
  setSession(res, user);
  res.json({ user: publicUser({ ...user, verified: 1 }) });
});

authRouter.post('/resend', requireUser, limit, async (req, res) => {
  if (req.user.verified) return res.json({ ok: true });
  const token = newToken();
  db.prepare('UPDATE users SET verify_token = ? WHERE id = ?').run(token, req.user.id);
  res.json({ ok: true, ...(await sendVerification({ ...req.user, verify_token: token })) });
});
