# PYQ Hub

Previous year question papers for NITK, in one place. Students find papers by branch,
year and course, preview and download them, and upload the ones that are missing.
Admins check every upload before it goes live.

![Home page: search and branch list](docs/screenshots/home.png)

- [Using PYQ Hub (students)](#using-pyq-hub-students)
- [Running PYQ Hub (admins)](#running-pyq-hub-admins)
- [Running it on your computer](#running-it-on-your-computer)
- [Deploying the server](#deploying-the-server)
- [Configuration](#configuration)

---

## Using PYQ Hub (students)

You don't need an account to find, preview or download papers. You only need one to upload.

### Find a paper

Type a course code or name in the **Course** line on the home page. Matching courses
appear as you type; press <kbd>Enter</kbd> or pick one to open it. `CS301`, `cs 301`
and `CS-301` all work. To search across courses instead, press **Search papers**, and
narrow it down by exam year or mid-sem / end-sem if you like.

![Course suggestions while typing](docs/screenshots/search-suggestions.png)

You can also browse: pick your branch on the home page, then your year of study.
First-year courses are shared by every branch and appear under 1st year in each one.

### Read a course page

Each course has a grid of years and exams. Every cell tells you where that paper stands:

| Cell | Meaning |
|---|---|
| Mint download icon, "Download" | The paper is up. Select the cell to download it. |
| Peach, "Waiting for review" | Someone has uploaded it and an admin is checking it. No need to upload it again. |
| Dashed box, "Not uploaded yet" | Nobody has it yet. Select **+ Upload it** if you do. |

![Course page with the year by exam grid](docs/screenshots/course.png)

### Search results

Search results show each matching course with its last five years. Each year has an
**M** (mid-sem) and an **E** (end-sem) square. A filled mint square opens the paper; a
dashed square means it's missing and takes you to the upload form.

![Search results with coverage squares](docs/screenshots/search-results.png)

Opening a paper shows it in the page, with **Download PDF** and **Open in new tab**.
If the preview doesn't show on your phone, use Download PDF.

![A paper open in the viewer](docs/screenshots/paper.png)

### Create an account

Select **Sign in**, then **Create an account**. Use your college email (it must end in
`@nitk.edu.in`). We email you a link; open it to confirm your address. You can browse
straight away, but uploading needs a confirmed email.

![Sign-up form rejecting a non-college email](docs/screenshots/sign-up.png)

### Upload a paper

1. Select **Upload**, or select a dashed "Not uploaded yet" cell, which fills in the
   course, year and exam for you.
2. Check the course, exam year and mid-sem / end-sem.
3. Attach the question paper as **one PDF** with every page, up to 20 MB.
4. Add a note if something is unusual ("makeup exam", "page 4 is faint").
5. Select **Submit for review**.

![Upload form, prefilled from a missing slot](docs/screenshots/upload.png)

An admin checks that it's the right course, year and complete. Track it under
**My uploads**:

| Stamp | Meaning |
|---|---|
| Pending review | Waiting for an admin. |
| Approved | Live for everyone. |
| Rejected | Not published. The reason is shown underneath; fix it and upload again. |
| Replaced | An admin swapped it for a better copy of the same paper. |

![My uploads with review stamps](docs/screenshots/my-uploads.png)

If an identical file is already on the site, the upload is refused straight away so the
archive doesn't fill with copies.

---

## Running PYQ Hub (admins)

### Your account

The first admin account is created when the server starts for the first time, from
`ADMIN_EMAIL`, `ADMIN_NAME` and `ADMIN_PASSWORD` (see [Configuration](#configuration)).
Set a strong password **before** the first start; the app has no password-change screen yet.

To make someone else an admin, ask them to sign up, then change their role to **Admin**
under **Admin → People**.

Sign in and select **Admin** in the top bar. The number next to it is how many uploads
are waiting for you.

### Overview

Totals at the top (approved papers, uploads waiting, downloads, accounts, contributors),
downloads per day for the last 30 days, the most downloaded papers, what students search
for, papers per branch, and **courses with no papers**: the list to send round when
asking seniors for papers.

![Admin overview](docs/screenshots/admin-overview.png)

### Review queue

Uploads appear oldest first, with the PDF on the left. For each one, check the course,
year and exam match the paper, and that every page is there and readable.

- **Approve** publishes it.
- **Approve and replace old copy** appears when the same course, year and exam already
  has an approved paper. Use it when the new scan is better; the old one is marked Replaced.
- **Reject** asks for a reason. The quick reasons (pages missing, unreadable, wrong
  course or year, not a question paper) fill it in. The student sees the reason under My uploads.

![Review queue with the reject form open](docs/screenshots/admin-review-queue.png)

### Papers

Every approved, rejected and replaced paper, filterable by course code. **Delete**
removes the paper and its PDF permanently; use it for anything that shouldn't be on the
site at all.

### People

Everyone with an account: what they've uploaded, when they joined, and their role.
Change a role with the dropdown. **Suspend** (it asks you to confirm) stops someone
signing in or uploading; **Restore** undoes it. Their approved papers stay up.

![People table](docs/screenshots/admin-people.png)

### Courses

Students can only upload papers for courses that exist. Add new courses and electives
here with their code, name, branch (or "Common to all" for first-year courses) and year
of study.

![Add a course](docs/screenshots/admin-courses.png)

---

## Running it on your computer

Needs **Node.js 22.13 or newer**. The database is Node's built-in SQLite, so there is
nothing else to install.

```sh
npm install
npm run seed:demo   # optional: demo students, ~250 sample papers, 30 days of activity
npm start           # http://localhost:3000
```

- Admin: `admin@nitk.edu.in` / `admin12345`
- Demo student: `ananya.211cs107@nitk.edu.in` / `student123`

Use `npm run dev` to restart automatically when server files change. Without SMTP
settings, verification links are printed in the terminal and shown on screen.

<p>
  <img src="docs/screenshots/mobile-course.png" alt="Course page on a phone" width="260">
  <img src="docs/screenshots/mobile-search.png" alt="Search results on a phone" width="260">
</p>

---

## Deploying the server

PYQ Hub is one Node process that serves both the website and the API. It keeps its
database and uploaded PDFs in one folder (`DATA_DIR`, default `./data`), so it needs a
host with a **persistent disk**: a VPS, or a platform service with a mounted disk.

Before going live, whichever host you use:

- Set `NODE_ENV=production`, a long random `JWT_SECRET`, `BASE_URL` (the public address,
  used in verification emails), the admin details and SMTP. The server refuses to start
  in production without `JWT_SECRET`.
- Serve it over **HTTPS**. In production the sign-in cookie is marked secure, so sign-in
  won't stick over plain HTTP.
- Don't run `npm run seed:demo` on the live server.

### Option A: a Linux VPS (Ubuntu) with nginx

**1. Install Node 22 and get the code**

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo useradd --system --create-home --home-dir /srv/pyq-hub pyq
sudo -u pyq git clone <your-repo-url> /srv/pyq-hub/app
cd /srv/pyq-hub/app && sudo -u pyq npm ci --omit=dev
```

**2. Configure it.** Create `/srv/pyq-hub/app/.env` from `.env.example`:

```sh
NODE_ENV=production
PORT=3000
BASE_URL=https://pyq.example.edu
JWT_SECRET=<output of: openssl rand -hex 32>
DATA_DIR=/srv/pyq-hub/data
ADMIN_EMAIL=you@nitk.edu.in
ADMIN_NAME=Site moderator
ADMIN_PASSWORD=<a strong password>
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM="PYQ Hub <no-reply@nitk.edu.in>"
```

```sh
sudo chmod 600 /srv/pyq-hub/app/.env && sudo chown pyq /srv/pyq-hub/app/.env
```

**3. Keep it running with systemd.** Save as `/etc/systemd/system/pyq-hub.service`:

```ini
[Unit]
Description=PYQ Hub
After=network.target

[Service]
User=pyq
WorkingDirectory=/srv/pyq-hub/app
EnvironmentFile=/srv/pyq-hub/app/.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now pyq-hub
sudo journalctl -u pyq-hub -f     # "PYQ Hub running at ..." means it's up
```

**4. Put nginx in front.** Save as `/etc/nginx/sites-available/pyq-hub`:

```nginx
server {
    server_name pyq.example.edu;
    client_max_body_size 25m;   # a little above MAX_UPLOAD_MB

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```sh
sudo ln -s /etc/nginx/sites-available/pyq-hub /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pyq.example.edu      # adds HTTPS
```

The `X-Forwarded-For` header matters: the server uses it to rate-limit sign-in attempts
per visitor rather than treating everyone as nginx.

**5. Update to a new version**

```sh
cd /srv/pyq-hub/app && sudo -u pyq git pull && sudo -u pyq npm ci --omit=dev
sudo systemctl restart pyq-hub
```

### Option B: Render (or Railway) with a disk

1. Create a **Web Service** from the repository.
2. Build command `npm ci`, start command `npm start`.
3. Add a **persistent disk** mounted at, for example, `/var/data`, and set
   `DATA_DIR=/var/data`.
4. Add the environment variables listed above, with `BASE_URL` set to the service's URL.
   Don't set `PORT`; the platform provides it. HTTPS is handled for you.

A disk ties the service to one instance, which is fine for a college-sized site.

> Serverless hosts such as Vercel throw away files between requests, so the database and
> uploads would vanish. To run there, swap `server/storage.js` for S3 or Firebase Storage
> and the SQLite database for Postgres or MongoDB first.

### Back up

Everything lives in `DATA_DIR`: `pyq.db` (accounts, courses, paper records, stats) and
`papers/` (the PDFs). Back up both, for example nightly from cron:

```sh
cd /srv/pyq-hub/data
node -e "new (require('node:sqlite').DatabaseSync)('pyq.db').exec(\"VACUUM INTO 'backup-$(date +%F).db'\")"
tar czf papers-$(date +%F).tgz papers
```

`VACUUM INTO` takes a consistent copy while the server is running; copying `pyq.db`
directly can catch it mid-write.

---

## Configuration

All settings are environment variables. Every one has a default for local use.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port the server listens on. |
| `BASE_URL` | `http://localhost:PORT` | Public address, used in verification emails. |
| `NODE_ENV` | | Set to `production` on a live server. |
| `JWT_SECRET` | dev-only value | Signs sign-in cookies. **Required** in production. |
| `DATA_DIR` | `./data` | Where the database and PDFs are stored. |
| `ALLOWED_EMAIL_DOMAIN` | `nitk.edu.in` | Only emails at this domain can sign up. |
| `MAX_UPLOAD_MB` | `20` | Largest PDF accepted. |
| `ADMIN_EMAIL` | `admin@nitk.edu.in` | First admin account, created on first start only. |
| `ADMIN_NAME` | `Site moderator` | Its display name. |
| `ADMIN_PASSWORD` | `admin12345` | Its password. Change before first start. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | | Mail server for verification emails. Without it, links go to the server log. |

## Project layout

```
server/            Express API; index.js wires it up
  db.js            schema, course catalog and first admin
  storage.js       PDF storage (local disk; same interface an S3 driver would use)
  routes/          auth, catalog, papers, admin
public/            the website: plain HTML, CSS and JS modules, no build step
docs/screenshots/  images used in this README
data/              created at runtime: pyq.db and papers/ (not committed)
```
