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
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pyqhub',
  // S3-compatible storage for the PDFs (Filebase, Cloudflare R2, Backblaze B2...). Without it
  // they are kept on local disk under dataDir/papers. The older R2_* names still work.
  s3: (env.S3_BUCKET || env.R2_BUCKET)
    ? {
        bucket: env.S3_BUCKET || env.R2_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY,
        endpoint:
          env.S3_ENDPOINT || env.R2_ENDPOINT || (env.R2_ACCOUNT_ID && `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`),
        region: env.S3_REGION || 'auto',
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

if (config.s3) {
  const missing = Object.entries({
    S3_ACCESS_KEY_ID: config.s3.accessKeyId,
    S3_SECRET_ACCESS_KEY: config.s3.secretAccessKey,
    S3_ENDPOINT: config.s3.endpoint,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) throw new Error(`S3_BUCKET is set, so these are needed too: ${missing.join(', ')}`);
}
