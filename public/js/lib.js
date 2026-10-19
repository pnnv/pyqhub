// Escaping template helper: interpolated values are escaped unless wrapped in raw().
class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export const raw = (value) => new Raw(value);

const escape = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const render = (value) => {
  if (value == null || value === false) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escape(value);
};

export const html = (strings, ...values) =>
  raw(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ''), ''));

// ---------- API ----------

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Shared state ----------

export const session = { user: null };

// ---------- Formatting ----------

export const examLabel = (type) => (type === 'mid' ? 'Mid-sem' : 'End-sem');

export const yearLabel = (n) => `${n}${['st', 'nd', 'rd', 'th'][Math.min(n, 4) - 1]} year`;

export const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

export function fileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const toDate = (sqlTime) => new Date(`${sqlTime.replace(' ', 'T')}Z`);

export function timeAgo(sqlTime) {
  const seconds = (toDate(sqlTime) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const steps = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [86400 * 30, 'day'],
    [86400 * 365, 'month'],
  ];
  for (const [limit, unit] of steps) {
    if (Math.abs(seconds) < limit) {
      const size = { second: 1, minute: 60, hour: 3600, day: 86400, month: 86400 * 30 }[unit];
      return rtf.format(Math.round(seconds / size), unit);
    }
  }
  return rtf.format(Math.round(seconds / (86400 * 365)), 'year');
}

export const shortDate = (sqlTime) =>
  toDate(sqlTime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// Wraps the part of `text` that matches `query` in <mark>. Returns escaped HTML.
export function highlight(text, query) {
  const q = query.trim();
  if (!q) return html`${text}`;
  const normalise = (s) => s.toLowerCase();
  const plain = normalise(text);
  let at = plain.indexOf(normalise(q));
  let len = q.length;
  if (at === -1) {
    // Course codes: "cs 301" should mark "CS301".
    const compact = normalise(q.replace(/[\s-]+/g, ''));
    at = plain.indexOf(compact);
    len = compact.length;
  }
  if (at === -1 || !len) return html`${text}`;
  return html`${text.slice(0, at)}<mark>${text.slice(at, at + len)}</mark>${text.slice(at + len)}`;
}

// ---------- Toast ----------

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export const examYears = () => {
  const now = new Date().getFullYear();
  return Array.from({ length: now - 2009 }, (_, i) => now - i);
};
