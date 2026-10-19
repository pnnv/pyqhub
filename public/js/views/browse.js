import { api, examLabel, fileSize, highlight, html, plural, shortDate, timeAgo, yearLabel } from '../lib.js';

// Course codes are written one character per box, like the roll-number boxes on an answer sheet.
export const boxedCode = (code) =>
  html`<span class="boxed" aria-label="${code}">${[...code].map((c) => html`<span aria-hidden="true">${c}</span>`)}</span>`;

export async function branchView({ params, query }) {
  const { branch, subjects } = await api(`/branches/${encodeURIComponent(params.code)}`);
  const years = [1, 2, 3, 4];
  const year = years.includes(Number(query.get('year'))) ? Number(query.get('year')) : null;
  const shown = year ? subjects.filter((s) => s.year === year) : subjects;
  const groups = years
    .map((y) => [y, shown.filter((s) => s.year === y)])
    .filter(([, list]) => list.length);

  return {
    title: branch.name,
    body: html`
      <div class="margin page-head">
        <p class="crumbs"><a href="/">All branches</a></p>
        <h1 class="branch-title"><span class="branch-code">${branch.code}</span> ${branch.name}</h1>
        <nav class="seg year-tabs" aria-label="Year of study">
          <a href="/branch/${branch.code}" ${year ? '' : html`aria-current="page"`}>All years</a>
          ${years.map(
            (y) => html`<a href="/branch/${branch.code}?year=${y}" ${year === y ? html`aria-current="page"` : ''}>${yearLabel(y)}</a>`,
          )}
        </nav>
      </div>
      <div class="margin">
        ${groups.map(
          ([y, list]) => html`<section class="year-group">
            <h2 class="section-title">${yearLabel(y)}${list.every((s) => !s.branch) ? html` <span class="muted small">common to all branches</span>` : ''}</h2>
            <ul class="rows">
              ${list.map(
                (s) => html`<li>
                  <a class="row-link" href="/course/${s.code}">
                    <span class="row-code">${s.code}</span>
                    <span class="row-title">${s.name}</span>
                    <span class="row-meta ${s.papers ? '' : 'none'}">${s.papers ? plural(s.papers, 'paper') : 'No papers yet'}</span>
                  </a>
                </li>`,
              )}
            </ul>
          </section>`,
        )}
      </div>
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

export async function courseView({ params }) {
  const { subject, papers, pending } = await api(`/subjects/${encodeURIComponent(params.code)}`);
  const thisYear = new Date().getFullYear();
  const slot = (list, y, t) => list.filter((p) => p.exam_year === y && p.exam_type === t);

  // Rows run from this year down to the earliest year anyone has sent a paper for.
  const known = [...papers, ...pending].map((p) => p.exam_year);
  const earliest = known.length ? Math.min(...known, thisYear) : thisYear - 2;
  const years = Array.from({ length: thisYear - earliest + 1 }, (_, i) => thisYear - i);
  const waiting = pending.filter((p) => !slot(papers, p.exam_year, p.exam_type).length);

  const approvedYears = papers.map((p) => p.exam_year);
  const [first, last] = [Math.min(...approvedYears), Math.max(...approvedYears)];
  const summary = html`${papers.length
    ? `${plural(papers.length, 'paper')} from ${first}${first === last ? '' : ` to ${last}`}.`
    : 'No papers yet.'}${waiting.length ? html` ${listSlots(waiting)} waiting for review.` : ''}`;

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

  return {
    title: `${subject.code} ${subject.name}`,
    body: html`
      <div class="page-head course-head">
        <p class="crumbs">
          ${subject.branch
            ? html`<a href="/branch/${subject.branch}?year=${subject.year}">${subject.branch_name}, ${yearLabel(subject.year)}</a>`
            : html`First-year course, common to all branches`}
        </p>
        <h1>${boxedCode(subject.code)}<span class="course-name">${subject.name}</span></h1>
        <p class="lede num">${summary}</p>
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
    `,
  };
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
  const params = new URLSearchParams({ q, year, type });
  const { papers, courses } = await api(`/papers?${params}`);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => thisYear - i);

  const filters = [year && `from ${year}`, type && `${examLabel(type).toLowerCase()} only`].filter(Boolean);
  const heading = q ? html`Papers matching “${q}”` : 'All papers';

  return {
    title: q ? `Search: ${q}` : 'All papers',
    body: html`
      <div class="page-head">
        <p class="crumbs"><a href="/">New search</a></p>
        <h1>${heading}</h1>
        <p class="lede num">
          ${papers.length ? `${plural(papers.length, 'paper')} in ${plural(courses.length, 'course')}` : 'No papers found'}${filters.length ? `, ${filters.join(', ')}` : ''}.
        </p>
      </div>
      ${courses.length
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
                      <span class="small muted num">${plural(c.total, 'paper')}</span>
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
    `,
  };
}

export async function paperView({ params }) {
  const { paper } = await api(`/papers/${encodeURIComponent(params.id)}`);
  const file = `/api/papers/${paper.id}/file`;
  const title = `${paper.subject_code} ${examLabel(paper.exam_type)} ${paper.exam_year}`;
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
          <h1>${examLabel(paper.exam_type)} ${paper.exam_year}</h1>
          <div class="paper-actions">
            <a class="btn" href="${file}?download=1" download>Download PDF</a>
            <a class="btn btn-quiet" href="${file}" target="_blank" rel="noopener">Open in new tab</a>
          </div>
        </div>
        <p class="lede">
          ${paper.subject_name}. Uploaded by ${paper.uploader ?? 'a student'} on ${shortDate(paper.created_at)}, ${fileSize(paper.file_size)}.
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
