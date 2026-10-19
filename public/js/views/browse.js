import { api, dayMonth, examLabel, fileSize, highlight, html, paperTitle, plural, shortDate, timeAgo, yearLabel } from '../lib.js';

// Course codes are written one character per box, like the roll-number boxes on an answer sheet.
export const boxedCode = (code) =>
  html`<span class="boxed" aria-label="${code}">${[...code].map((c) => html`<span aria-hidden="true">${c}</span>`)}</span>`;

// "5 papers, 2 quizzes", "3 quizzes" or "No papers yet"
export function countsLabel({ papers, quizzes }) {
  const parts = [papers && plural(papers, 'paper'), quizzes && plural(quizzes, 'quiz', 'quizzes')].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No papers yet';
}

const semesterOf = (s) => (s.semester ? `Semester ${s.semester}` : 'Elective');

export async function branchView({ params, query }) {
  const { branch, subjects } = await api(`/branches/${encodeURIComponent(params.code)}`);
  const years = [1, 2, 3, 4];
  const tab = query.get('year') === 'electives' ? 'electives' : years.includes(Number(query.get('year'))) ? Number(query.get('year')) : null;
  const electives = subjects.filter((s) => !s.semester);
  const semesters = [1, 2, 3, 4, 5, 6, 7, 8]
    .filter((n) => !tab || tab === Math.ceil(n / 2))
    .map((n) => [`Semester ${n}`, subjects.filter((s) => s.semester === n)])
    .filter(([, list]) => list.length);
  const groups = tab === 'electives' ? [['Electives', electives]] : semesters;
  const tabLink = (value, label) =>
    html`<a href="/branch/${branch.code}${value ? `?year=${value}` : ''}" ${tab === value ? html`aria-current="page"` : ''}>${label}</a>`;

  return {
    title: branch.name,
    body: html`
      <div class="page-head">
        <p class="crumbs"><a href="/">All branches</a></p>
        <h1 class="branch-title"><span class="branch-code">${branch.code}</span> ${branch.name}</h1>
        <nav class="seg year-tabs" aria-label="Year of study">
          ${tabLink(null, 'All years')}
          ${years.map((y) => tabLink(y, yearLabel(y)))}
          ${electives.length ? tabLink('electives', 'Electives') : ''}
        </nav>
      </div>
      ${groups.map(
        ([title, list]) => html`<section class="year-group">
          <h2 class="section-title">${title}</h2>
          <ul class="rows">
            ${list.map(
              (s) => html`<li>
                <a class="row-link" href="/course/${s.code}">
                  <span class="row-code">${s.code}</span>
                  <span class="row-title">${s.name}</span>
                  <span class="row-meta ${s.papers || s.quizzes ? '' : 'none'}">${countsLabel(s)}</span>
                </a>
              </li>`,
            )}
          </ul>
        </section>`,
      )}
      ${tab !== 'electives' && electives.length
        ? html`<p class="small muted after-list">
            Plus ${plural(electives.length, 'elective')} you can choose from.
            <a href="/branch/${branch.code}?year=electives">See the electives</a>
          </p>`
        : ''}
    `,
  };
}

const EXAMS = ['mid', 'end'];
const DOWNLOAD_ICON = html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 3v9m-4-4 4 4 4-4M4 15h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// "the 2025 end-sem", "the 2025 end-sem and 2024 mid-sem", "3 papers"
function listSlots(slots) {
  if (slots.length > 2) return html`${slots.length} papers are`;
  const names = slots.map((p) => html`<span class="nowrap">${p.exam_year} ${examLabel(p.exam_type).toLowerCase()}</span>`);
  return html`The ${names[0]}${names[1] ? html` and ${names[1]}` : ''} ${names.length > 1 ? 'are' : 'is'}`;
}

// Where a course sits: "Computer Science and Engineering, semester 4" or "…, elective"
const offeringLabel = (o) => `${o.branch_name}, ${o.semester ? `semester ${o.semester}` : 'elective'}`;
const offeringLink = (o) =>
  html`<a href="/branch/${o.branch}?year=${o.semester ? Math.ceil(o.semester / 2) : 'electives'}">${offeringLabel(o)}</a>`;

export async function courseView({ params }) {
  const { subject, offerings, papers: all, pending: allPending } = await api(`/subjects/${encodeURIComponent(params.code)}`);
  const thisYear = new Date().getFullYear();
  const isQuiz = (p) => p.exam_type === 'quiz';
  const papers = all.filter((p) => !isQuiz(p));
  const quizzes = all.filter(isQuiz);
  const pending = allPending.filter((p) => !isQuiz(p));
  const pendingQuizzes = allPending.filter(isQuiz);
  const slot = (list, y, t) => list.filter((p) => p.exam_year === y && p.exam_type === t);

  // Rows run from this year down to the earliest year anyone has sent a paper or quiz for.
  const known = [...all, ...allPending].map((p) => p.exam_year);
  const earliest = known.length ? Math.min(...known, thisYear) : thisYear - 2;
  const years = Array.from({ length: thisYear - earliest + 1 }, (_, i) => thisYear - i);
  const waiting = pending.filter((p) => !slot(papers, p.exam_year, p.exam_type).length);

  const approvedYears = papers.map((p) => p.exam_year);
  const [first, last] = [Math.min(...approvedYears), Math.max(...approvedYears)];
  const quizNote = quizzes.length ? `, and ${plural(quizzes.length, 'quiz', 'quizzes')}` : '';
  const summary = html`${papers.length
    ? `${plural(papers.length, 'paper')} from ${first}${first === last ? '' : ` to ${last}`}${quizNote}.`
    : quizzes.length ? `No mid-sem or end-sem papers yet${quizNote.replace(', and', ', but')}.` : 'No papers yet.'}${
    waiting.length ? html` ${listSlots(waiting)} waiting for review.` : ''}`;

  const cell = (y, t) => {
    const label = `${subject.code} ${examLabel(t).toLowerCase()} ${y}`;
    const approved = slot(papers, y, t);
    if (approved.length) {
      return approved.map(
        (p) => html`<a class="slot slot-paper" href="/api/papers/${p.id}/file?download=1" download
            aria-label="Download ${label}, ${plural(p.downloads, 'download')}">
          <span class="dl" aria-hidden="true">${DOWNLOAD_ICON}</span>
          <span class="slot-main">
            <span class="slot-title">Download</span>
            <span class="slot-by">Uploaded by ${p.uploader ?? 'a student'}</span>
          </span>
          <span class="slot-count">${p.downloads.toLocaleString('en-IN')}<span class="count-word"> downloads</span></span>
        </a>`,
      );
    }
    const queued = slot(pending, y, t)[0];
    if (queued) {
      return html`<div class="slot slot-waiting">
        <span class="slot-title">Waiting for review</span>
        <span class="slot-by">Uploaded by ${queued.uploader ?? 'a student'} ${timeAgo(queued.created_at)}</span>
      </div>`;
    }
    return html`<a class="slot slot-missing" href="/upload?course=${subject.code}&year=${y}&exam=${t}"
        aria-label="${label} is missing, upload it">
      <span>Not uploaded yet</span>
      <span class="slot-add">+ Upload it</span>
    </a>`;
  };

  // Quizzes have no fixed slots: every quiz from a year sits in that year's row, in the
  // order they were held. A busy year shows its latest few; the rest open in place.
  const VISIBLE_QUIZZES = 8;
  const quizCard = (q, earlier) => html`<a class="quiz quiz-paper" href="/api/papers/${q.id}/file?download=1" download
      ${earlier ? 'hidden data-earlier' : ''} title="${q.quiz_label || 'Quiz'}${q.held_on ? `, ${shortDate(q.held_on)}` : ''}"
      aria-label="Download ${subject.code} ${paperTitle(q)}, ${plural(q.downloads, 'download')}">
    <span class="dl dl-small" aria-hidden="true">${DOWNLOAD_ICON}</span>
    <span class="quiz-name">${q.quiz_label || 'Quiz'}</span>
    ${q.held_on ? html`<span class="quiz-date">${dayMonth(q.held_on)}</span>` : ''}
    <span class="quiz-count">${q.downloads.toLocaleString('en-IN')}</span>
  </a>`;
  const quizRow = (y) => {
    const here = quizzes
      .filter((q) => q.exam_year === y)
      .sort((a, b) => (a.held_on ?? '9').localeCompare(b.held_on ?? '9') || (a.quiz_label ?? '').localeCompare(b.quiz_label ?? ''));
    const queued = pendingQuizzes.filter((q) => q.exam_year === y);
    const hidden = Math.max(0, here.length - VISIBLE_QUIZZES);
    return html`
      ${hidden ? html`<button type="button" class="quiz quiz-more" data-expand aria-expanded="false">Show ${hidden} earlier</button>` : ''}
      ${here.map((q, i) => quizCard(q, i < hidden))}
      ${queued.map(
        (q) => html`<span class="quiz quiz-waiting" title="${q.quiz_label || 'Quiz'}, waiting for review">
          <span class="quiz-name">${q.quiz_label || 'Quiz'}</span><span class="quiz-date">waiting for review</span>
        </span>`,
      )}
      <a class="quiz quiz-add" href="/upload?course=${subject.code}&year=${y}&exam=quiz"
        aria-label="Add a ${y} quiz for ${subject.code}">+ Add a quiz</a>`;
  };

  const [home, ...others] = offerings;
  return {
    title: `${subject.code} ${subject.name}`,
    body: html`
      <div class="page-head course-head">
        <p class="crumbs">${home ? offeringLink(home) : 'Not listed under any branch'}</p>
        <h1>${boxedCode(subject.code)}<span class="course-name">${subject.name}</span></h1>
        <p class="lede num">${summary}</p>
        ${subject.ltp || others.length
          ? html`<p class="course-facts small">
              ${subject.ltp ? html`<span class="nowrap">L-T-P ${subject.ltp}</span>${subject.credits ? html`, <span class="nowrap">${plural(subject.credits, 'credit')}</span>` : ''}.` : ''}
              ${others.length ? html` Also taught in ${others.map((o, i) => html`${i ? (i === others.length - 1 ? ' and ' : ', ') : ''}${offeringLink(o)}`)}.` : ''}
            </p>`
          : ''}
      </div>
      <div class="exam-grid">
        <table>
          <caption class="visually-hidden">${subject.code} papers by year and exam</caption>
          <thead>
            <tr><th scope="col" class="year-col">Year</th>${EXAMS.map((t) => html`<th scope="col">${examLabel(t)}</th>`)}</tr>
          </thead>
          <tbody>
            ${years.map(
              (y) => html`<tr>
                <th scope="row" class="year-col">${y}</th>
                ${EXAMS.map((t) => html`<td>${cell(y, t)}</td>`)}
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <p class="small muted after-list num">
        Nothing from ${earliest - 1} or earlier yet. <a href="/upload?course=${subject.code}">Upload one if you have it.</a>
      </p>

      <section class="quizzes" aria-labelledby="quizzes-title">
        <h2 class="section-title" id="quizzes-title">Quizzes</h2>
        <p class="small muted quizzes-note">
          Quizzes happen whenever the instructor sets one, so a year can have any number of them.
        </p>
        <div class="exam-grid quiz-grid">
          <table>
            <caption class="visually-hidden">${subject.code} quizzes by year</caption>
            <thead><tr><th scope="col" class="year-col">Year</th><th scope="col">Quizzes</th></tr></thead>
            <tbody>
              ${years.map(
                (y) => html`<tr>
                  <th scope="row" class="year-col">${y}</th>
                  <td><div class="quiz-list">${quizRow(y)}</div></td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
      </section>
    `,
    mount(root) {
      root.querySelector('.quiz-grid').addEventListener('click', (e) => {
        const button = e.target.closest('[data-expand]');
        if (!button) return;
        const row = button.parentElement;
        row.querySelectorAll('[data-earlier]').forEach((el) => (el.hidden = false));
        row.querySelector('.quiz-paper')?.focus();
        button.remove();
      });
    },
  };
}

// Quiz search: each course with its quizzes, newest first, instead of the exam strip.
function quizResults(courses, papers, q) {
  const LIMIT = 7; // with "N more", two full rows of four
  return html`<ul class="results">
    ${courses.map((c) => {
      const mine = papers.filter((p) => p.subject_code === c.code);
      return html`<li class="result">
        <a class="result-head" href="/course/${c.code}">
          <span class="row-code">${highlight(c.code, q)}</span>
          <span class="result-name">
            <span class="row-title">${highlight(c.name, q)}</span>
            <span class="small muted num">${plural(mine.length, 'quiz', 'quizzes')}</span>
          </span>
        </a>
        <div class="quiz-list">
          ${mine.slice(0, LIMIT).map(
            (p) => html`<a class="quiz quiz-paper" href="/paper/${p.id}">
              <span class="quiz-name">${p.quiz_label || 'Quiz'}</span>
              <span class="quiz-date">${p.held_on ? shortDate(p.held_on) : p.exam_year}</span>
            </a>`,
          )}
          ${mine.length > LIMIT ? html`<a class="quiz quiz-more" href="/course/${c.code}#quizzes-title">${mine.length - LIMIT} more on the course page</a>` : ''}
        </div>
      </li>`;
    })}
  </ul>`;
}

const square = (course, year, type, paper) => {
  const letter = type === 'mid' ? 'M' : 'E';
  const what = `${course} ${examLabel(type).toLowerCase()} ${year}`;
  return paper
    ? html`<a class="sq sq-have" href="/paper/${paper.id}" aria-label="${what}, open the paper">${letter}</a>`
    : html`<a class="sq sq-missing" href="/upload?course=${course}&year=${year}&exam=${type}" aria-label="${what} is missing, upload it">${letter}</a>`;
};

export async function searchView({ query }) {
  const q = query.get('q') ?? '';
  const year = query.get('year') ?? '';
  const type = query.get('type') ?? '';
  const params = new URLSearchParams({ q, year, type, page: query.get('page') ?? '1' });
  const { papers, courses, total, page, pages, perPage } = await api(`/papers?${params}`);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => thisYear - i);

  const typeFilter = type === 'quiz' ? 'quizzes only' : type && `${examLabel(type).toLowerCase()} only`;
  const filters = [year && `from ${year}`, typeFilter].filter(Boolean);
  const what = type === 'quiz' ? 'Quizzes' : 'Papers';
  const heading = q ? html`${what} matching “${q}”` : `All ${what.toLowerCase()}`;

  return {
    title: q ? `Search: ${q}` : 'All papers',
    body: html`
      <div class="page-head">
        <p class="crumbs"><a href="/">New search</a></p>
        <h1>${heading}</h1>
        <p class="lede num">
          ${total.papers
            ? `${type === 'quiz' ? plural(total.papers, 'quiz', 'quizzes') : plural(total.papers, 'paper')} in ${plural(total.courses, 'course')}`
            : 'Nothing found'}${filters.filter((f) => f !== 'quizzes only').length ? `, ${filters.filter((f) => f !== 'quizzes only').join(', ')}` : ''}.
        </p>
      </div>
      ${courses.length && type === 'quiz'
        ? quizResults(courses, papers, q)
        : courses.length
        ? html`<p class="legend small">
              <span class="sq sq-have sq-mini" aria-hidden="true">M</span> is a paper you can open.
              <span class="sq sq-missing sq-mini" aria-hidden="true">E</span> is missing; choose it to upload one.
              M is mid-sem, E is end-sem. Showing ${years.at(-1)} to ${thisYear}.
            </p>
            <ul class="results">
              ${courses.map(
                (c) => html`<li class="result">
                  <a class="result-head" href="/course/${c.code}">
                    <span class="row-code">${highlight(c.code, q)}</span>
                    <span class="result-name">
                      <span class="row-title">${highlight(c.name, q)}</span>
                      <span class="small muted num">${countsLabel({ papers: c.total, quizzes: c.quizzes })}</span>
                    </span>
                  </a>
                  <div class="strip" role="group" aria-label="${c.code} papers, ${years.at(-1)} to ${thisYear}">
                    ${years.map(
                      (y) => html`<div class="strip-year">
                        <div class="strip-pair">
                          ${['mid', 'end'].map((t) => square(c.code, y, t, c.slots.find((p) => p.exam_year === y && p.exam_type === t)))}
                        </div>
                        <span class="strip-label">${y}</span>
                      </div>`,
                    )}
                  </div>
                </li>`,
              )}
            </ul>`
        : html`<div class="notice">
            <p>Nothing matches${q ? html` “${q}”` : ''}${filters.length ? ` ${filters.join(', ')}` : ''}.</p>
            <p>Search by course code like <a href="/search?q=CS301">CS301</a> or by name, or
              ${year || type ? html`<a href="/search?q=${encodeURIComponent(q)}">remove the filters</a>` : html`<a href="/">browse by branch</a>`}.
            </p>
          </div>`}
      ${pages > 1 ? pager(params, page, pages, perPage, total.courses) : ''}
    `,
  };
}

// "Courses 41-64 of 64" with links to the neighbouring pages
function pager(params, page, pages, perPage, count) {
  const link = (n) => {
    const next = new URLSearchParams(params);
    next.set('page', n);
    return `/search?${next}`;
  };
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, count);
  return html`<nav class="pager" aria-label="Result pages">
    ${page > 1 ? html`<a class="btn btn-quiet" href="${link(page - 1)}">Previous courses</a>` : html`<span></span>`}
    <span class="small muted num">Courses ${from}–${to} of ${count}</span>
    ${page < pages ? html`<a class="btn btn-quiet" href="${link(page + 1)}">Next courses</a>` : html`<span></span>`}
  </nav>`;
}

export async function paperView({ params }) {
  const { paper } = await api(`/papers/${encodeURIComponent(params.id)}`);
  const file = `/api/papers/${paper.id}/file`;
  const title = `${paper.subject_code} ${paperTitle(paper)}`;
  const status =
    paper.status === 'approved'
      ? ''
      : html`<div class="notice ${paper.status === 'rejected' ? 'bad' : 'warn'}" style="margin-bottom:20px">
          <p>
            ${paper.status === 'pending'
              ? 'Only you and the admins can see this paper until it is approved.'
              : paper.status === 'rejected'
                ? `Rejected: ${paper.reject_reason}`
                : 'A newer copy of this paper replaced this one.'}
          </p>
        </div>`;

  return {
    title,
    body: html`
      <div class="margin page-head paper-head">
        <p class="crumbs"><a href="/course/${paper.subject_code}">${paper.subject_code} ${paper.subject_name}</a></p>
        <div class="paper-title-row">
          <h1>${paperTitle(paper)}</h1>
          <div class="paper-actions">
            <a class="btn" href="${file}?download=1" download>Download PDF</a>
            <a class="btn btn-quiet" href="${file}" target="_blank" rel="noopener">Open in new tab</a>
          </div>
        </div>
        <p class="lede">
          ${paper.subject_name}.${paper.held_on ? ` Held on ${shortDate(paper.held_on)}.` : ''}
          Uploaded by ${paper.uploader ?? 'a student'} on ${shortDate(paper.created_at)}, ${fileSize(paper.file_size)}.
          ${paper.note ? html`<br />Note: ${paper.note}` : ''}
        </p>
      </div>
      <div class="margin">
        ${status}
        <div class="viewer">
          <iframe src="${file}#toolbar=0&navpanes=0&view=FitH" title="${title} question paper"></iframe>
        </div>
        <p class="small muted viewer-fallback">
          If the preview doesn't show on your phone, use <a href="${file}?download=1" download>Download PDF</a>.
        </p>
      </div>
    `,
  };
}
