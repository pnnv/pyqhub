// Local-disk file store. Keeps the same three calls an S3/Firebase driver would need,
// so swapping storage later only touches this file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const dir = path.join(config.dataDir, 'papers');
fs.mkdirSync(dir, { recursive: true });

const resolve = (key) => {
  if (!/^[a-f0-9]{32}\.pdf$/.test(key)) throw new Error('Invalid file key');
  return path.join(dir, key);
};

export const storage = {
  async save(buffer) {
    const key = `${crypto.randomBytes(16).toString('hex')}.pdf`;
    await fs.promises.writeFile(resolve(key), buffer);
    return key;
  },
  stream(key) {
    return fs.createReadStream(resolve(key));
  },
  async remove(key) {
    await fs.promises.rm(resolve(key), { force: true });
  },
};
