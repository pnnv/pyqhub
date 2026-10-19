import { api, html, session } from './lib.js';
import { homeView } from './views/home.js';
import { branchView, courseView, paperView, searchView } from './views/browse.js';
import { signinView, signupView, verifyView } from './views/account.js';
import { myUploadsView, uploadView } from './views/upload.js';
import { adminView } from './views/admin.js';

const routes = [
  ['/', homeView],
  ['/search', searchView],
  ['/branch/:code', branchView],
  ['/course/:code', courseView],
  ['/paper/:id', paperView],
  ['/signin', signinView],
  ['/signup', signupView],
  ['/verify/:token', verifyView],
  ['/upload', uploadView],
  ['/my-uploads', myUploadsView],
  ['/admin', adminView],
  ['/admin/:tab', adminView],
];

const LOGO = html`<svg viewBox="0 0 32 32" aria-hidden="true"><rect x=".5" y=".5" width="31" height="31" rx="6" fill="#fffefb" stroke="#dad8ec"/><path d="M1 11h30M1 18h30M1 25h30" stroke="#d5e3f6" stroke-width="1.5"/><path d="M8 1v30" stroke="#f2a9b6" stroke-width="2"/><path d="M13 22V9h5.2a3.9 3.9 0 0 1 0 7.8H13" fill="none" stroke="#2d3463" stroke-width="2.6" stroke-linejoin="round"/></svg>`;

const compiled = routes.map(([pattern, view]) => {
  const keys = [];
  const re = new RegExp(
    `^${pattern.replace(/:(\w+)/g, (_, k) => {
      keys.push(k);
      return '([^/]+)';
    })}/?$`,
  );
  return { re, keys, view };
});

function match(pathname) {
  for (const { re, keys, view } of compiled) {
    const m = pathname.match(re);
    if (m) return { view, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return { view: notFoundView, params: {} };
}

function notFoundView() {
  return {
    title: 'Page not found',
    body: html`<div class="margin page-head">
      <h1>This page isn't here</h1>
      <p class="lede">The link may be old or mistyped. <a href="/">Go back to the search</a>.</p>
    </div>`,
  };
}

export function renderMasthead() {
  const { user } = session;
  const path = location.pathname;
  const link = (href, label, extra = '') =>
    html`<a href="${href}" ${path === href || (href !== '/' && path.startsWith(`${href}/`)) ? html`aria-current="page"` : ''}>${label}${extra}</a>`;

  document.getElementById('masthead').innerHTML = html`<div class="masthead-inner">
    <a class="wordmark" href="/">${LOGO}PYQ Hub</a>
    <nav class="nav" aria-label="Main">
      ${link('/', 'Find papers')}
      ${link('/upload', 'Upload')}
      ${user ? link('/my-uploads', 'My uploads') : ''}
      ${user?.role === 'admin' ? link('/admin', 'Admin', session.pending ? html`<span class="count" aria-label="${session.pending} waiting">${session.pending}</span>` : '') : ''}
    </nav>
    <div class="account">
      ${user
        ? html`<span class="who">${user.name}</span><a href="/signout" data-action="signout">Sign out</a>`
        : html`<a href="/signin" ${path === '/signin' ? html`aria-current="page"` : ''}>Sign in</a>`}
    </div>
  </div>`.value;
}

let renderId = 0;
export async function render({ focus = false } = {}) {
  const id = ++renderId;
  const main = document.getElementById('main');
  const { view, params } = match(location.pathname);
  const query = new URLSearchParams(location.search);
  renderMasthead();

  let page;
  try {
    page = await view({ params, query });
  } catch (err) {
    page = {
      title: 'Something went wrong',
      body: html`<div class="margin page-head">
        <h1>${err.status === 404 ? 'Not found' : 'Could not load this page'}</h1>
        <p class="lede">${err.message}</p>
      </div>`,
    };
  }
  if (id !== renderId) return; // a newer navigation finished first
  if (page.redirect) return navigate(page.redirect, { replace: true });

  document.title = page.title ? `${page.title} | PYQ Hub` : 'PYQ Hub';
  main.innerHTML = page.body.value;
  page.mount?.(main);
  if (focus) main.focus({ preventScroll: true });
}

export function navigate(url, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  window.scrollTo(0, 0);
  render({ focus: true });
}

document.addEventListener('click', async (e) => {
  const a = e.target.closest('a');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.dataset.action === 'signout') {
    e.preventDefault();
    await api('/auth/logout', { method: 'POST' });
    session.user = null;
    navigate('/');
    return;
  }
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || a.target || a.hasAttribute('download') || url.pathname.startsWith('/api/')) return;
  e.preventDefault();
  if (url.pathname + url.search !== location.pathname + location.search) navigate(url.pathname + url.search);
});

window.addEventListener('popstate', () => render());

export async function refreshSession() {
  const { user } = await api('/auth/me');
  session.user = user;
  if (user?.role === 'admin') {
    const { papers } = await api('/admin/queue');
    session.pending = papers.length;
  }
}

await refreshSession().catch(() => {});
render();
