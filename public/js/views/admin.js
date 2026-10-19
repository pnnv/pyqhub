import { api, examLabel, paperTitle, fileSize, html, plural, session, shortDate, timeAgo, toast } from '../lib.js';
import { navigate, renderMasthead } from '../app.js';
import { stamp } from './upload.js';

const TABS = [
  ['', 'Overview'],
  ['queue', 'Review queue'],
  ['papers', 'Papers'],
  ['people', 'People'],
  ['courses', 'Courses'],
];

const REJECT_REASONS = ['Pages are missing', 'Scan is unreadable', 'Wrong course or year', 'Not a question paper'];

const compact = (n) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K` : n.toLocaleString('en-IN'));

function shell(tab, content) {
  return html`
    <div class="margin page-head admin-head">
      <h1>Admin</h1>
      <nav class="seg admin-tabs" aria-label="Admin sections">
        ${TABS.map(
          ([key, label]) => html`<a href="/admin${key ? `/${key}` : ''}" ${tab === key ? html`aria-current="page"` : ''}>${label}${key === 'queue' && session.pending ? ` (${session.pending})` : ''}</a>`,
        )}
      </nav>
    </div>
    <div class="margin">${content}</div>`;
}

export async function adminView({ params, query }) {
  if (!session.user) return { redirect: '/signin?next=/admin' };
  if (session.user.role !== 'admin') {
    return { title: 'Admin', body: html`<div class="margin page-head"><h1>Admins only</h1><p class="lede">Your account doesn't have admin access.</p></div>` };
  }
  const tab = params.tab ?? '';
  const view = { '': overview, queue, papers: papersTab, people, courses }[tab];
  if (!view) return { redirect: '/admin' };
  const page = await view(query);
  return { title: `Admin: ${TABS.find(([k]) => k === tab)[1]}`, body: shell(tab, page.body), mount: page.mount };
}

// ---------- Overview ----------

async function overview() {
  const s = await api('/admin/stats');
  session.pending = s.totals.pending;
  renderMasthead();
  const maxBranch = Math.max(1, ...s.byBranch.map((b) => b.papers));

  return {
    body: html`
      <dl class="figures">
        <div><dt>Approved papers</dt><dd>${compact(s.totals.approved)}</dd></div>
        <div><dt>Quizzes</dt><dd>${compact(s.totals.quizzes)}</dd></div>
        <div><dt>Waiting for review</dt><dd>${s.totals.pending ? html`<a href="/admin/queue">${s.totals.pending}</a>` : '0'}</dd></div>
        <div><dt>Downloads, all time</dt><dd>${compact(s.totals.downloads)}</dd></div>
        <div><dt>Accounts</dt><dd>${compact(s.totals.users)}</dd></div>
        <div><dt>Contributors</dt><dd>${compact(s.totals.contributors)}</dd></div>
      </dl>

      <section class="chart-block">
        <h2 class="section-title">Downloads per day, last 30 days</h2>
        ${dailyChart(s.daily)}
      </section>

      <div class="two-col">
        <section>
          <h2 class="section-title">Most downloaded</h2>
          <ol class="rows ranked">
            ${s.topPapers.map(
              (p) => html`<li><a href="/paper/${p.id}"><span><span class="code">${p.subject_code}</span> ${paperTitle(p)}</span><span class="muted small">${plural(p.downloads, 'download')}</span></a></li>`,
            )}
          </ol>
        </section>
        <section>
          <h2 class="section-title">Top searches, last 30 days</h2>
          ${s.topSearches.length
            ? html`<ol class="rows ranked">
                ${s.topSearches.map(
                  (t) => html`<li><a href="/search?q=${encodeURIComponent(t.term)}"><span>${t.term}</span><span class="muted small">${plural(t.count, 'search', 'searches')}</span></a></li>`,
                )}
              </ol>`
            : html`<p class="muted">No searches yet.</p>`}
        </section>
      </div>

      <div class="two-col">
        <section>
          <h2 class="section-title">Papers by branch</h2>
          <ul class="branch-bars">
            ${s.byBranch.map(
              (b) => html`<li>
                <span class="bb-label">${b.branch}</span>
                <span class="bb-track"><span style="width:${(b.papers / maxBranch) * 100}%"></span></span>
                <span class="bb-value">${b.papers}</span>
              </li>`,
            )}
          </ul>
        </section>
        <section>
          <h2 class="section-title">Core courses with no papers</h2>
          <p class="muted small" style="margin-bottom:12px">
            ${plural(s.missingCount, 'core course')} still have no mid-sem or end-sem paper. Earliest semesters first;
            ask seniors for these.
          </p>
          <div class="chip-list">
            ${s.missing.map((c) => html`<a class="chip code" href="/course/${c.code}" title="${c.name}">${c.code}</a>`)}
          </div>
        </section>
      </div>
    `,
    mount(root) {
      const chart = root.querySelector('.chart');
      const tip = root.querySelector('.chart-tip');
      if (!chart) return;
      const show = (bar) => {
        tip.hidden = false;
        tip.textContent = `${bar.dataset.label}: ${bar.dataset.value} downloads`;
        const box = chart.getBoundingClientRect();
        const b = bar.getBoundingClientRect();
        tip.style.left = `${Math.min(Math.max(b.left - box.left + b.width / 2, 70), box.width - 70)}px`;
        chart.querySelectorAll('.hit.on').forEach((el) => el.classList.remove('on'));
        bar.classList.add('on');
      };
      chart.addEventListener('pointerover', (e) => e.target.closest('.hit') && show(e.target.closest('.hit')));
      chart.addEventListener('focusin', (e) => e.target.closest('.hit') && show(e.target.closest('.hit')));
      chart.addEventListener('pointerleave', () => {
        tip.hidden = true;
        chart.querySelectorAll('.hit.on').forEach((el) => el.classList.remove('on'));
      });
    },
  };
}

function dailyChart(daily) {
  // Fill gaps so every one of the 30 days has a slot.
  const byDay = new Map(daily.map((d) => [d.day, d.downloads]));
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push({ day: d, value: byDay.get(d) ?? 0 });
  }
  const max = Math.max(...days.map((d) => d.value), 1);
  const step = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];

  const W = 720, H = 220, L = 36, B = 24, T = 10;
  const plotW = W - L, plotH = H - B - T;
  const slot = plotW / days.length;
  const barW = Math.min(16, slot - 2);
  const y = (v) => T + plotH - (v / top) * plotH;
  const label = (day) => new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  // 4px rounded top, square at the baseline.
  const bar = (x, h) => {
    const r = Math.min(4, h / 2, barW / 2);
    const yb = T + plotH;
    return `M${x},${yb}V${yb - h + r}Q${x},${yb - h} ${x + r},${yb - h}H${x + barW - r}Q${x + barW},${yb - h} ${x + barW},${yb - h + r}V${yb}Z`;
  };

  return html`
    <div class="chart">
      <div class="chart-scroll"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart of downloads per day for the last 30 days, peaking at ${max}.">
        ${ticks.map(
          (t) => html`<line x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}" class="grid" /><text x="${L - 8}" y="${y(t) + 4}" class="axis" text-anchor="end">${compact(t)}</text>`,
        )}
        ${days.map((d, i) => {
          const x = L + i * slot + (slot - barW) / 2;
          const h = (d.value / top) * plotH;
          return html`<g class="hit" tabindex="0" data-label="${label(d.day)}" data-value="${d.value}">
            <rect x="${L + i * slot}" y="${T}" width="${slot}" height="${plotH}" fill="transparent" />
            ${d.value ? html`<path d="${bar(x, h)}" class="bar" />` : ''}
          </g>`;
        })}
        ${[0, 14, 29].map(
          (i) => html`<text x="${L + i * slot + slot / 2}" y="${H - 6}" class="axis" text-anchor="${i === 0 ? 'start' : i === 29 ? 'end' : 'middle'}">${i === 29 ? 'Today' : label(days[i].day)}</text>`,
        )}
      </svg></div>
      <div class="chart-tip" hidden></div>
    </div>
    <details class="chart-table">
      <summary>Show as table</summary>
      <table class="table">
        <thead><tr><th>Day</th><th>Downloads</th></tr></thead>
        <tbody>${days.map((d) => html`<tr><td>${label(d.day)}</td><td>${d.value}</td></tr>`)}</tbody>
      </table>
    </details>`;
}

// ---------- Review queue ----------

async function queue() {
  const { papers } = await api('/admin/queue');
  session.pending = papers.length;
  renderMasthead();

  if (!papers.length) {
    return { body: html`<div class="notice"><p><strong>Nothing to review.</strong></p><p>New uploads will show up here.</p></div>` };
  }

  return {
    body: html`
      <p class="muted queue-count">${plural(papers.length, 'paper')} waiting, oldest first.</p>
      <ol class="queue">
        ${papers.map(
          (p) => html`<li class="review" data-id="${p.id}">
            <div class="review-preview">
              <iframe src="/api/papers/${p.id}/file#toolbar=0&navpanes=0&view=FitH" title="Preview of ${p.subject_code} ${paperTitle(p)}" loading="lazy"></iframe>
            </div>
            <div class="review-body">
              <h2><a class="code" href="/course/${p.subject_code}">${p.subject_code}</a> ${paperTitle(p)}</h2>
              <p class="muted">${p.subject_name}</p>
              <dl class="review-meta">
                <dt>Uploaded by</dt><dd><span class="nowrap">${p.uploader ?? 'Deleted account'}</span>${p.uploader_email ? html`<br /><span class="small muted">${p.uploader_email}</span>` : ''}</dd>
                <dt>When</dt><dd>${timeAgo(p.created_at)}</dd>
                <dt>File</dt><dd>${p.original_name ?? 'PDF'}, ${fileSize(p.file_size)}</dd>
                ${p.note ? html`<dt>Note</dt><dd>${p.note}</dd>` : ''}
              </dl>
              ${p.existing.length
                ? html`<div class="notice warn small">
                    <p>
                      ${p.subject_code} already has an approved ${paperTitle(p)}
                      (${p.existing.map((e, i) => html`${i ? ', ' : ''}<a href="/paper/${e.id}" target="_blank" rel="noopener">view copy</a>`)}).
                      Add this one alongside it, or replace the old copy if this scan is better.
                    </p>
                  </div>`
                : ''}
              <div class="review-actions">
                <button class="btn" data-act="approve">Approve</button>
                ${p.existing.length ? html`<button class="btn btn-quiet" data-act="replace" data-replace="${p.existing.map((e) => e.id).join(',')}">Approve and replace old copy</button>` : ''}
                <button class="btn btn-danger" data-act="reject-open">Reject</button>
              </div>
              <form class="reject-form" hidden>
                <label class="field"><span>Reason the uploader will see</span>
                  <input class="input" name="reason" maxlength="300" required />
                </label>
                <div class="quick-reasons">
                  ${REJECT_REASONS.map((r) => html`<button type="button" class="chip" data-reason="${r}">${r}</button>`)}
                </div>
                <div class="form-actions">
                  <button class="btn btn-danger" type="submit">Reject paper</button>
                  <button class="btn btn-quiet" type="button" data-act="reject-cancel">Cancel</button>
                </div>
              </form>
              <p class="form-error error" role="alert"></p>
            </div>
          </li>`,
        )}
      </ol>`,
    mount(root) {
      // Chrome's viewer paints a dark backdrop before the page; keep the paper showing until it loads.
      root.querySelectorAll('.review-preview iframe').forEach((frame) =>
        frame.addEventListener('load', () => frame.classList.add('loaded')),
      );
      const done = (item, message) => {
        item.remove();
        session.pending = Math.max(0, (session.pending ?? 1) - 1);
        renderMasthead();
        root.querySelector('.admin-tabs a[href="/admin/queue"]').textContent = `Review queue${session.pending ? ` (${session.pending})` : ''}`;
        root.querySelector('.queue-count').textContent = session.pending
          ? `${plural(session.pending, 'paper')} waiting, oldest first.`
          : 'All caught up.';
        toast(message);
      };
      const label = (item) => item.querySelector('h2').textContent.trim();

      root.querySelector('.queue')?.addEventListener('click', async (e) => {
        const button = e.target.closest('button');
        const item = e.target.closest('.review');
        if (!button || !item) return;
        const form = item.querySelector('.reject-form');
        const error = item.querySelector('.form-error');

        if (button.dataset.reason) {
          form.elements.reason.value = button.dataset.reason;
          form.elements.reason.focus();
          return;
        }
        const act = button.dataset.act;
        if (act === 'reject-open') {
          form.hidden = false;
          form.elements.reason.focus();
        } else if (act === 'reject-cancel') {
          form.hidden = true;
        } else if (act === 'approve' || act === 'replace') {
          button.disabled = true;
          try {
            const replace = act === 'replace' ? button.dataset.replace.split(',') : [];
            await api(`/admin/papers/${item.dataset.id}/approve`, { method: 'POST', body: { replace } });
            done(item, `Approved ${label(item)}${replace.length ? ', old copy replaced' : ''}`);
          } catch (err) {
            error.textContent = err.message;
            button.disabled = false;
          }
        }
      });

      root.querySelectorAll('.reject-form').forEach((form) =>
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const item = form.closest('.review');
          const error = item.querySelector('.form-error');
          const reason = form.elements.reason.value.trim();
          if (!reason) {
            error.textContent = 'Give the uploader a reason so they can fix it.';
            return;
          }
          try {
            await api(`/admin/papers/${item.dataset.id}/reject`, { method: 'POST', body: { reason } });
            done(item, `Rejected ${label(item)}`);
          } catch (err) {
            error.textContent = err.message;
          }
        }),
      );
    },
  };
}

// ---------- Papers ----------

async function papersTab(query) {
  const status = query.get('status') ?? 'approved';
  const q = query.get('q') ?? '';
  const { papers } = await api(`/admin/papers?${new URLSearchParams({ status, q })}`);
  const statusLink = (value, label) =>
    html`<a href="/admin/papers?status=${value}${q ? `&q=${encodeURIComponent(q)}` : ''}" ${status === value ? html`aria-current="page"` : ''}>${label}</a>`;

  return {
    body: html`
      <div class="toolbar">
        <nav class="seg" aria-label="Status">
          ${statusLink('approved', 'Approved')}${statusLink('rejected', 'Rejected')}${statusLink('superseded', 'Replaced')}
        </nav>
        <form class="code-filter" role="search">
          <input class="input" name="q" value="${q}" placeholder="Filter by course code" aria-label="Filter by course code" />
        </form>
      </div>
      ${papers.length
        ? html`<ul class="rows admin-papers">
            ${papers.map(
              (p) => html`<li class="upload-row" data-id="${p.id}">
                <div>
                  <a class="paper-exam" href="/paper/${p.id}">${p.subject_code} ${paperTitle(p)}</a>
                  <p class="small muted">
                    <span class="nowrap">${p.uploader ?? 'Deleted account'}</span>, ${shortDate(p.created_at)}.
                    ${p.status === 'approved' ? `${plural(p.downloads, 'download')}, ${plural(p.views, 'view')}.` : ''}
                    ${p.reject_reason ? html`<span class="reject-reason">${p.reject_reason}</span>` : ''}
                  </p>
                </div>
                <div class="row-actions">
                  ${status !== 'approved' ? stamp(p.status) : ''}
                  <button class="btn btn-danger btn-small" data-delete>Delete</button>
                </div>
              </li>`,
            )}
          </ul>`
        : html`<p class="muted">No ${status === 'superseded' ? 'replaced' : status} papers${q ? ` for ${q.toUpperCase()}` : ''}.</p>`}
    `,
    mount(root) {
      root.querySelector('.code-filter').addEventListener('submit', (e) => {
        e.preventDefault();
        navigate(`/admin/papers?${new URLSearchParams({ status, q: e.target.elements.q.value.trim() })}`);
      });
      root.querySelector('.admin-papers')?.addEventListener('click', async (e) => {
        if (!e.target.matches('[data-delete]')) return;
        const row = e.target.closest('li');
        const name = row.querySelector('.paper-exam').textContent;
        if (!confirm(`Delete ${name}? The PDF is removed for good.`)) return;
        await api(`/admin/papers/${row.dataset.id}`, { method: 'DELETE' });
        row.remove();
        toast(`Deleted ${name}`);
      });
    },
  };
}

// ---------- People ----------

const uploadSummary = (u) => {
  if (!u.uploads) return 'None yet';
  const parts = [`${u.approved} approved`];
  if (u.rejected) parts.push(`${u.rejected} rejected`);
  if (u.pending) parts.push(`${u.pending} waiting`);
  return parts.join(', ');
};

const accessButton = (banned) =>
  banned
    ? html`<button class="link-quiet" data-act="restore">Restore</button>`
    : html`<button class="link-danger" data-act="suspend">Suspend</button>`;

async function people() {
  const { users } = await api('/admin/users');
  return {
    body: html`
      <div class="table-wrap">
        <table class="table people">
          <thead><tr><th>Name</th><th>Email</th><th>Uploads</th><th>Joined</th><th>Role</th><th><span class="visually-hidden">Access</span></th></tr></thead>
          <tbody>
            ${users.map(
              (u) => html`<tr data-id="${u.id}" class="${u.banned ? 'is-banned' : ''}">
                <td><strong>${u.name}</strong>${u.verified ? '' : html`<br /><span class="small muted">Email not confirmed</span>`}</td>
                <td class="small person-email">${u.email}</td>
                <td class="num nowrap">${uploadSummary(u)}</td>
                <td class="small muted person-joined"><span class="joined-label">Joined </span>${shortDate(u.created_at)}</td>
                <td>
                  ${u.id === session.user.id
                    ? html`<span class="small muted">You, admin</span>`
                    : html`<select class="select select-small" data-role aria-label="Role for ${u.name}">
                        <option value="student" ${u.role === 'student' ? 'selected' : ''}>Student</option>
                        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                      </select>`}
                </td>
                <td>
                  ${u.id === session.user.id
                    ? ''
                    : accessButton(u.banned)}
                </td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>`,
    mount(root) {
      const table = root.querySelector('.people');
      table.addEventListener('change', async (e) => {
        if (!e.target.matches('[data-role]')) return;
        const row = e.target.closest('tr');
        await api(`/admin/users/${row.dataset.id}`, { method: 'PATCH', body: { role: e.target.value } });
        toast(`${row.querySelector('strong').textContent} is now ${e.target.value === 'admin' ? 'an admin' : 'a student'}`);
      });
      // Suspending asks once more in place; restoring doesn't need to.
      table.addEventListener('click', async (e) => {
        const button = e.target.closest('button[data-act]');
        if (!button) return;
        const row = button.closest('tr');
        const cell = button.closest('td');
        const name = row.querySelector('strong').textContent;
        const act = button.dataset.act;
        if (act === 'suspend') {
          cell.innerHTML = html`<span class="confirm">Suspend ${name}?
            <button class="link-danger" data-act="suspend-yes">Suspend</button>
            <button class="link-quiet" data-act="cancel">Cancel</button></span>`.value;
          cell.querySelector('[data-act=cancel]').focus();
          return;
        }
        if (act === 'cancel') {
          cell.innerHTML = accessButton(false).value;
          return;
        }
        const banned = act === 'suspend-yes';
        await api(`/admin/users/${row.dataset.id}`, { method: 'PATCH', body: { banned } });
        row.classList.toggle('is-banned', banned);
        cell.innerHTML = accessButton(banned).value;
        toast(`${name} ${banned ? 'suspended' : 'restored'}`);
      });
    },
  };
}

// ---------- Courses ----------

async function courses() {
  const { branches } = await api('/branches');
  return {
    body: html`
      <h2 class="section-title">Add a course</h2>
      <p class="muted courses-note">
        Every lecture course in the 2025 curriculum is already listed. Add new electives here, or add an existing
        course to another branch by entering its code.
      </p>
      <form class="stack-form" novalidate>
        <div class="field-row">
          <label class="field field-code"><span>Course code</span>
            <input class="input code" name="code" placeholder="CS355" required />
          </label>
          <label class="field field-grow"><span>Course name <span class="hint">not needed if it exists</span></span>
            <input class="input" name="name" placeholder="Advanced Algorithms" />
          </label>
        </div>
        <div class="field-row">
          <label class="field field-grow"><span>Branch</span>
            <select class="select" name="branch" required>
              ${branches.map((b) => html`<option value="${b.code}">${b.code} ${b.name}</option>`)}
            </select>
          </label>
          <label class="field"><span>Semester</span>
            <select class="select" name="semester">
              <option value="">Elective</option>
              ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => html`<option value="${n}">Semester ${n}</option>`)}
            </select>
          </label>
        </div>
        <p class="form-error error" role="alert"></p>
        <div class="form-actions"><button class="btn" type="submit">Add course</button></div>
      </form>`,
    mount(root) {
      const form = root.querySelector('form');
      const error = root.querySelector('.form-error');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        error.textContent = '';
        try {
          const { subject } = await api('/admin/subjects', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
          const where = `${subject.branch}, ${subject.semester ? `semester ${subject.semester}` : 'elective'}`;
          toast(subject.added === 'course' ? `Added ${subject.code} ${subject.name} (${where})` : `${subject.code} is now also listed under ${where}`);
          form.elements.code.value = '';
          form.elements.name.value = '';
          form.elements.code.focus();
        } catch (err) {
          error.textContent = err.message;
        }
      });
    },
  };
}
