import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';

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

// Attaches req.user when a valid session cookie is present; never rejects.
export function loadUser(req, _res, next) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const { sub } = jwt.verify(token, config.jwtSecret);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(sub);
      if (user && !user.banned) req.user = user;
    } catch {
      // expired or tampered token: treat as signed out
    }
  }
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
