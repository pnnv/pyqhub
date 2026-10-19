import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

export const config = {
  root,
  port: Number(env.PORT) || 3000,
  isProd: env.NODE_ENV === 'production',
  baseUrl: env.BASE_URL || `http://localhost:${Number(env.PORT) || 3000}`,
  dataDir: env.DATA_DIR || path.join(root, 'data'),
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  emailDomain: (env.ALLOWED_EMAIL_DOMAIN || 'nitk.edu.in').toLowerCase(),
  maxUploadMb: Number(env.MAX_UPLOAD_MB) || 20,
  admin: {
    email: env.ADMIN_EMAIL || 'admin@nitk.edu.in',
    name: env.ADMIN_NAME || 'Site moderator',
    password: env.ADMIN_PASSWORD || 'admin12345',
  },
  // Cloudflare R2 for the PDFs. Without it they are kept on local disk under dataDir/papers.
  r2: env.R2_BUCKET
    ? {
        bucket: env.R2_BUCKET,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        endpoint: env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      }
    : null,
  smtp: env.SMTP_HOST
    ? {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT) || 587,
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
        from: env.SMTP_FROM || 'PYQ Hub <no-reply@nitk.edu.in>',
      }
    : null,
};

if (config.isProd && config.jwtSecret === 'dev-only-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}

if (config.r2) {
  const missing = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].filter((k) => !env[k]);
  if (!env.R2_ACCOUNT_ID && !env.R2_ENDPOINT) missing.push('R2_ACCOUNT_ID');
  if (missing.length) throw new Error(`R2_BUCKET is set, so these are needed too: ${missing.join(', ')}`);
}
