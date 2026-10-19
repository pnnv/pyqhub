# PYQ Hub

Previous year question papers for NITK, organised Branch → Year → Course → Paper.
Students browse, search, preview and download papers; signed-in students upload PDFs;
admins approve or reject each upload and see usage stats.

## Run it

Needs Node 22.13+ (uses the built-in `node:sqlite`, so there is no database to install).

```sh
npm install
npm run seed:demo   # optional: demo students, ~250 generated sample papers, 30 days of activity
npm start           # http://localhost:3000
```

Admin: `admin@nitk.edu.in` / `admin12345` (set `ADMIN_EMAIL` / `ADMIN_PASSWORD` before first start).
Demo students: e.g. `ananya.211cs107@nitk.edu.in` / `student123`.

Configuration lives in environment variables; see `.env.example`. Without SMTP settings,
email verification links are printed to the server log and shown on screen in development.

## What's in it

| Module | Where |
|---|---|
| Auth: sign-up restricted to the college domain, email verification, JWT in an httpOnly cookie | `server/routes/auth.js`, `server/auth.js` |
| Browse: branches, year of study, courses (first-year courses are shared by all branches) | `server/routes/catalog.js`, `public/js/views/browse.js` |
| Search & filter by course code or name, exam year, mid-sem / end-sem | `GET /api/papers` |
| Upload: PDF check, 20 MB limit, exact-duplicate detection by SHA-256 | `server/routes/papers.js`, `public/js/views/upload.js` |
| Moderation: queue with inline preview, same-slot duplicate warning, approve / approve-and-replace / reject with reason | `server/routes/admin.js`, `public/js/views/admin.js` |
| Admin dashboard: totals, downloads per day, top papers and searches, courses with no papers, users, courses | same |

```
server/          Express API (index.js wires it up)
  db.js          schema + catalog seed + first admin
  storage.js     PDF storage; local disk now, same interface for S3/Firebase later
public/          static frontend, plain HTML/CSS/JS modules, no build step
data/            created at runtime: pyq.db and papers/ (git-ignored)
```

## Deploying

Any Node host with a persistent disk works (Render with a disk, a VPS, Railway). Set
`NODE_ENV=production`, `JWT_SECRET`, `BASE_URL` and SMTP. Vercel's serverless functions
have no persistent disk, so on Vercel swap `storage.js` for S3/Firebase and the database
for Postgres/MongoDB first.
