// Where uploaded PDFs live. Cloudflare R2 when R2_BUCKET is set, otherwise local disk.
// Both drivers have the same calls, so nothing outside this file knows which one is in use.
//
// The database stores only the key ("<32 hex>.pdf"); the file itself is here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

const newKey = () => `${crypto.randomBytes(16).toString('hex')}.pdf`;
const checkKey = (key) => {
  if (!/^[a-f0-9]{32}\.pdf$/.test(key)) throw new Error('Invalid file key');
  return key;
};
const disposition = ({ filename, download }) => `${download ? 'attachment' : 'inline'}; filename="${filename}"`;

function localDisk() {
  const dir = path.join(config.dataDir, 'papers');
  fs.mkdirSync(dir, { recursive: true });
  const file = (key) => path.join(dir, checkKey(key));

  return {
    name: `local disk (${dir})`,
    async check() {},
    async save(buffer) {
      const key = newKey();
      await fs.promises.writeFile(file(key), buffer);
      return key;
    },
    // The server streams the file itself.
    async deliver(key, options) {
      return { stream: fs.createReadStream(file(key)), disposition: disposition(options) };
    },
    async remove(key) {
      await fs.promises.rm(file(key), { force: true });
    },
  };
}

function cloudflareR2({ bucket, endpoint, accessKeyId, secretAccessKey }) {
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  const objectKey = (key) => `papers/${checkKey(key)}`;

  return {
    name: `Cloudflare R2 bucket "${bucket}"`,
    async check() {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    },
    async save(buffer) {
      const key = newKey();
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: objectKey(key), Body: buffer, ContentType: 'application/pdf' }),
      );
      return key;
    },
    // Hands the browser a short-lived signed link, so PDFs download straight from R2
    // (free egress) instead of through this server. Each request gets a fresh link.
    async deliver(key, options) {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: objectKey(key),
          ResponseContentType: 'application/pdf',
          ResponseContentDisposition: disposition(options),
        }),
        { expiresIn: 300 },
      );
      return { url };
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
    },
  };
}

export const storage = config.r2 ? cloudflareR2(config.r2) : localDisk();
