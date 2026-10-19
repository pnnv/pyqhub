// Copies the PDFs kept on local disk into the R2 bucket, under the same keys, so an
// existing install can switch to R2 without re-uploading anything. Safe to run again:
// files already in the bucket are skipped.
//
//   npm run storage:copy-to-r2        (with the R2_* settings in .env)
import fs from 'node:fs';
import path from 'node:path';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config.js';
import { db } from '../db.js';

if (!config.r2) {
  console.error('Set R2_BUCKET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY first (see .env.example).');
  process.exit(1);
}

const { bucket, endpoint, accessKeyId, secretAccessKey } = config.r2;
const client = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true });
const dir = path.join(config.dataDir, 'papers');

const exists = async (Key) => {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key }));
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
};

const keys = db.prepare('SELECT file_key FROM papers ORDER BY id').all().map((r) => r.file_key);
const counts = { copied: 0, already: 0, missing: 0 };
for (const [i, key] of keys.entries()) {
  const objectKey = `papers/${key}`;
  const file = path.join(dir, key);
  if (await exists(objectKey)) counts.already++;
  else if (!fs.existsSync(file)) {
    counts.missing++;
    console.warn(`missing on disk: ${key}`);
  } else {
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: fs.readFileSync(file), ContentType: 'application/pdf' }),
    );
    counts.copied++;
  }
  if ((i + 1) % 100 === 0) console.log(`${i + 1} of ${keys.length} checked`);
}

console.log(
  `Done: ${counts.copied} copied, ${counts.already} already in "${bucket}", ${counts.missing} missing on disk ` +
    `(of ${keys.length} papers). The local copies in ${dir} are untouched.`,
);
