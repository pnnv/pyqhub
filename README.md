# PYQ Hub

Previous year question papers and quizzes for NITK, in one place. Students find them by
branch, year and course (every lecture course in the 2025 UG curriculum is listed), preview
and download them, and upload the ones that are missing. Admins check every upload before
it goes live.

![Home page: search and branch list](docs/screenshots/home.png)

- [Using PYQ Hub (students)](#using-pyq-hub-students)
- [Running PYQ Hub (admins)](#running-pyq-hub-admins)
- [Running it on your computer](#running-it-on-your-computer)
- [Deploying (Render, MongoDB Atlas, Filebase)](#deploying-render-mongodb-atlas-filebase)

---

## Using PYQ Hub (students)

You don't need an account to find, preview or download papers. You only need one to upload.

### Find a paper

Type a course code or name in the **Course** line on the home page. Matching courses
appear as you type; press <kbd>Enter</kbd> or pick one to open it. `CS301`, `cs 301`
and `CS-301` all work. To search across courses instead, press **Search papers**, and
narrow it down by exam year or mid-sem / end-sem if you like.

![Course suggestions while typing](docs/screenshots/search-suggestions.png)

You can also browse: pick your branch on the home page, then your year. Courses are grouped
by semester, as in the curriculum's plan of study, and electives have their own tab. A
course taught in several branches, like Engineering Mathematics, is listed under each.

![Branch page grouped by semester](docs/screenshots/branch.png)

### Read a course page

Each course has a grid of years and exams. Every cell tells you where that paper stands:

| Cell | Meaning |
|---|---|
| Mint download icon, "Download" | The paper is up. Select the cell to download it. |
| Peach, "Waiting for review" | Someone has uploaded it and an admin is checking it. No need to upload it again. |
| Dashed box, "Not uploaded yet" | Nobody has it yet. Select **+ Upload it** if you do. |

Under the grid is the **Quizzes** section. Quizzes are set whenever the instructor decides,
so a year can hold any number of them. Each one shows its name and the date it was held;
peach ones are waiting for review, and **+ Add a quiz** uploads another for that year.

The line under the course name gives its L-T-P hours and credits, and any other branches
that teach it.

![Course page with the exam grid and quizzes](docs/screenshots/course.png)

### Search results

Search results show each matching course with its last five years. Each year has an
**M** (mid-sem) and an **E** (end-sem) square. A filled mint square opens the paper; a
dashed square means it's missing and takes you to the upload form.

![Search results with coverage squares](docs/screenshots/search-results.png)

Choose **Quizzes** under Exam on the home page to search quizzes instead. Each course is
listed with its quizzes, newest first.

![Quiz search results](docs/screenshots/search-quizzes.png)

Opening a paper shows it in the page, with **Download PDF** and **Open in new tab**.
If the preview doesn't show on your phone, use Download PDF.

![A paper open in the viewer](docs/screenshots/paper.png)

### Create an account

Select **Sign in**, then **Create an account**. Use your college email (it must end in
`@nitk.edu.in`). We email you a link; open it to confirm your address. You can browse
straight away, but uploading needs a confirmed email.

![Sign-up form rejecting a non-college email](docs/screenshots/sign-up.png)

### Upload a paper

1. Select **Upload**, or select a dashed "Not uploaded yet" cell or "+ Add a quiz", which
   fill in the course, year and exam for you.
2. Check the course, exam year, and whether it's a mid-sem, end-sem or quiz. For a quiz,
   add which one it was ("Quiz 2", "Surprise quiz") and the date if you know them; the date
   must fall in the exam year.
3. Attach the question paper as **one PDF** with every page, up to 20 MB.
4. Add a note if something is unusual ("makeup exam", "page 4 is faint").
5. Select **Submit for review**.

![Upload form, prefilled from a missing slot](docs/screenshots/upload.png)

![Uploading a quiz with its name and date](docs/screenshots/upload-quiz.png)

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
`ADMIN_EMAIL`, `ADMIN_NAME` and `ADMIN_PASSWORD` (environment variables; see `.env.example`).
Set a strong password **before** the first start; the app has no password-change screen yet.

To make someone else an admin, ask them to sign up, then change their role to **Admin**
under **Admin → People**.

Sign in and select **Admin** in the top bar. The number next to it is how many uploads
are waiting for you.

### Overview

Totals at the top (approved papers, quizzes, uploads waiting, downloads, accounts,
contributors), downloads per day for the last 30 days, the most downloaded papers, what
students search for, papers per branch, and **core courses with no papers**, earliest
semester first: the list to send round when asking seniors for papers.

![Admin overview](docs/screenshots/admin-overview.png)

### Review queue

Uploads appear oldest first, with the PDF on the left. For each one, check the course,
year and exam match the paper, and that every page is there and readable.

- **Approve** publishes it.
- **Approve and replace old copy** appears when the same course, year and exam already
  has an approved paper. Use it when the new scan is better; the old one is marked Replaced.
  For quizzes this only happens when a quiz with the same name in the same year exists,
  since a year can have many quizzes.
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

Every lecture course in the curriculum is already listed. Add a new elective with its code,
name, branch and semester (or **Elective**). To list an existing course under another
branch, enter just its code, the branch and the semester.

![Add a course](docs/screenshots/admin-courses.png)

---

## Running it on your computer

Needs **Node.js 22.13 or newer** and a **MongoDB** database. A free MongoDB Atlas (M0)
cluster works; so does MongoDB installed on your computer. Copy `.env.example` to `.env`
and set `MONGODB_URI` to your connection string.

```sh
npm install
npm run seed:demo   # optional: demo students, ~700 sample papers and ~200 quizzes, 30 days of activity
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

### Where things are stored

- **Accounts, courses and paper records:** MongoDB (`MONGODB_URI`).
- **The PDFs themselves:** an S3-compatible bucket when the `S3_*` settings are set,
  otherwise `data/papers/` on local disk. Filebase's free tier (5 GB, no card needed) works:
  create a bucket and an access key in Filebase, then set `S3_BUCKET`, `S3_ACCESS_KEY_ID`
  and `S3_SECRET_ACCESS_KEY` (the endpoint and region in `.env.example` are Filebase's).
  On start the server logs which one it is using.
- PDFs already on local disk can be copied into a newly set-up bucket with
  `npm run storage:copy-to-bucket`; it is safe to run again.

### Backups

Atlas's free tier keeps no backups, so export the database now and then:

```sh
npm run db:export   # writes backups/<date>/<collection>.json
```

Each file can be restored with `mongoimport` (the command is at the top of
`server/tools/export-db.js`).

### Updating the course list

Branches, courses and semesters come from `server/curriculum-2025.json`, built from the
curriculum PDF and applied on every start. Only courses with lecture hours are included;
labs, projects and seminars have no mid-sem or end-sem papers. For a new curriculum (needs
`pdftotext` from poppler-utils):

```sh
pdftotext -layout UG_Curriculum_2025_v4.pdf curriculum.txt
node server/tools/parse-curriculum.js curriculum.txt > server/curriculum-2025.json
```

---

## Deploying (Render, MongoDB Atlas, Filebase)

The site runs on three free services, each doing one job:

| Service | Holds | Free tier |
|---|---|---|
| **Render** | the website and API (one Node web service) | Sleeps after 15 minutes without visitors; the next visit takes about a minute to wake it |
| **MongoDB Atlas** | accounts, courses and paper records | 512 MB, no backups (see [Backups](#backups)) |
| **Filebase** | the PDFs | 5 GB, no card needed |

Render keeps nothing on its own disk, so restarts and redeploys lose nothing. Vercel and
Netlify don't suit this app: their functions reject requests over about 5 MB, which
blocks most scanned papers.

Set up Atlas and Filebase first; Render needs their details.

### 1. MongoDB Atlas (the database)

1. Sign up at [mongodb.com/atlas](https://www.mongodb.com/atlas) and create a **free (M0)**
   cluster. Pick the region closest to where you'll run Render (for India, Mumbai).
2. **Database Access → Add New Database User.** Choose password authentication, give it a
   long generated password, and the role **Read and write to any database**. Save the
   password somewhere safe.
3. **Network Access → Add IP Address → Allow access from anywhere** (`0.0.0.0/0`). Render's
   free tier has no fixed IP address, so the database password is what keeps it private.
4. **Database → Connect → Drivers.** Copy the connection string. It looks like:
   ```
   mongodb+srv://pyqhub:<password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority
   ```
   Put your password in place of `<password>`, and add the database name `pyqhub` after
   the `/`:
   ```
   mongodb+srv://pyqhub:YOUR-PASSWORD@cluster0.abcde.mongodb.net/pyqhub?retryWrites=true&w=majority
   ```
   This is your `MONGODB_URI`. If the password has symbols like `@`, `:` or `/`, either
   generate one without them or percent-encode them.

You don't need to create collections or indexes: the app does that on its first start.

### 2. Filebase (the PDFs)

1. Sign up at [filebase.com](https://filebase.com) (the free plan needs no card).
2. **Buckets → Create Bucket.** Choose **S3 compatible storage** (not IPFS), give it a
   name such as `pyqhub-papers`, and keep it **private**. Bucket names are shared across
   all Filebase users, so you may need a variation. This is your `S3_BUCKET`.
3. **Access Keys.** Copy the **Key** and **Secret**: these are `S3_ACCESS_KEY_ID` and
   `S3_SECRET_ACCESS_KEY`.

The bucket stays private. The app hands visitors short-lived signed download links, so
PDFs download straight from Filebase and pending papers are never exposed.

### 3. Render (the website)

1. Push this repository to GitHub, then sign up at [render.com](https://render.com) with
   your GitHub account.
2. **New → Web Service**, and pick the repository.
3. Fill in:
   - **Language:** Node
   - **Branch:** `main`
   - **Build command:** `npm ci`
   - **Start command:** `npm start`
   - **Instance type:** Free
   - **Region:** the same area as your Atlas cluster (Singapore is closest to Mumbai)
4. Under **Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `BASE_URL` | `https://<your-service-name>.onrender.com` (Render shows this address once the service is created; update it if it differs) |
   | `JWT_SECRET` | a long random string, e.g. the output of `openssl rand -hex 32` |
   | `MONGODB_URI` | the connection string from step 1 |
   | `S3_BUCKET` | your Filebase bucket name |
   | `S3_ENDPOINT` | `https://s3.filebase.com` |
   | `S3_REGION` | `us-east-1` |
   | `S3_ACCESS_KEY_ID` | Filebase key |
   | `S3_SECRET_ACCESS_KEY` | Filebase secret |
   | `ADMIN_EMAIL` | your `@nitk.edu.in` address |
   | `ADMIN_NAME` | the name shown in the header, e.g. `Site moderator` |
   | `ADMIN_PASSWORD` | a strong password |

   Optional: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` to send real
   verification emails (see `.env.example`). Don't set `PORT`; Render provides it.

5. **Create Web Service.** Render builds and starts the app. In the **Logs** tab you should
   see:
   ```
   Created admin account you@nitk.edu.in
   PYQ Hub running at https://<your-service-name>.onrender.com
   PDFs are stored in bucket "pyqhub-papers" at s3.filebase.com
   ```
   If it says `Can't connect to MongoDB`, check `MONGODB_URI` and Atlas's Network Access.
   If it says `Can't reach bucket`, check the three `S3_*` keys and the bucket name.

### 4. Check it works

1. Open the site and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. Upload a small PDF to any course, then approve it under **Admin → Review queue**.
3. Open the course page and download it. The file should come from `s3.filebase.com`.
4. In Filebase, the bucket should now hold the file under `papers/`.

The admin account is created only on the very first start. Changing `ADMIN_PASSWORD`
later does not change the existing account's password.

### Email

Without SMTP settings the site still works, but nobody can confirm their email, so
students can't upload. Until SMTP is set up, the verification link appears in Render's
logs; you can open it for a student, or connect any SMTP provider (Brevo, Mailgun, a
Gmail app password) through the `SMTP_*` variables.

### Updating the site

Every push to `main` redeploys automatically. Accounts, papers and PDFs live in Atlas and
Filebase, so redeploys and restarts lose nothing.

To fill the live site with demo data for a trial (not for the real launch), run
`npm run seed:demo` on your computer with the same `MONGODB_URI` and `S3_*` values in `.env`.

