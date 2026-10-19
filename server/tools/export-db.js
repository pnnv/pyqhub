// Writes every collection to backups/<timestamp>/<collection>.json (one Extended JSON
// document per line), because the free Atlas tier has no backups of its own.
// Restore a collection with mongoimport:
//   mongoimport --uri "$MONGODB_URI" --collection papers --file backups/<timestamp>/papers.json
//
//   npm run db:export
import fs from 'node:fs';
import path from 'node:path';
import { BSON } from 'mongodb';
import { config } from '../config.js';
import { client, db } from '../db.js';

await client.connect();
const dir = path.join(config.root, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(dir, { recursive: true });

for (const { name } of await db.listCollections().toArray()) {
  const out = fs.createWriteStream(path.join(dir, `${name}.json`));
  let n = 0;
  for await (const doc of db.collection(name).find()) {
    out.write(`${BSON.EJSON.stringify(doc, { relaxed: false })}\n`);
    n++;
  }
  await new Promise((done) => out.end(done));
  console.log(`${name}: ${n} documents`);
}
console.log(`Saved to ${dir}`);
await client.close();
