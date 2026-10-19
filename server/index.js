import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { config } from './config.js';
import './db.js';
import { HttpError, loadUser } from './auth.js';
import { authRouter } from './routes/auth.js';
import { catalogRouter } from './routes/catalog.js';
import { papersRouter } from './routes/papers.js';
import { adminRouter } from './routes/admin.js';

const app = express();
const publicDir = path.join(config.root, 'public');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(loadUser);

app.use('/api/auth', authRouter);
app.use('/api', catalogRouter);
app.use('/api', papersRouter);
app.use('/api/admin', adminRouter);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unknown API route.')));

app.use(express.static(publicDir));
// Client-side routes (/branch/CS, /paper/12, ...) all load the same page.
app.get('/{*path}', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `The PDF is larger than ${config.maxUploadMb} MB. Compress it and try again.`
        : 'Upload one PDF file at a time.';
    return res.status(400).json({ error: message });
  }
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server.' : err.message });
});

app.listen(config.port, () => {
  console.log(`PYQ Hub running at ${config.baseUrl}`);
});
