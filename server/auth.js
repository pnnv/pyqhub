import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { toId, users } from './db.js';

const COOKIE = 'pyq_session';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function setSession(res, user) {
  const token = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: MAX_AGE_MS,
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE);
}

export const publicUser = (u) =>
  u && { id: u.id, email: u.email, name: u.name, role: u.role, verified: Boolean(u.verified) };

// A user document with its id as a string, which is how the rest of the server compares ids.
export const withId = (u) => u && { ...u, id: u._id.toHexString() };

// Attaches req.user when a valid session cookie is present; never rejects.
export async function loadUser(req, _res, next) {
  const token = req.cookies?.[COOKIE];
  let sub = null;
  try {
    sub = token && jwt.verify(token, config.jwtSecret).sub;
  } catch {
    // expired or tampered token: treat as signed out
  }
  const _id = toId(sub);
  const user = _id && (await users.findOne({ _id }));
  if (user && !user.banned) req.user = withId(user);
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sign in to continue.'));
  next();
}

export function requireVerified(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sign in to continue.'));
  if (!req.user.verified) {
    return next(new HttpError(403, 'Confirm your college email before uploading.'));
  }
  next();
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Admins only.'));
  next();
}
