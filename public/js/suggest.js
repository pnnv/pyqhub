// Course-code combobox: suggests matching courses under a text input.
import { api, highlight, html } from './lib.js';

let subjectsPromise;
export const loadSubjects = () => (subjectsPromise ??= api('/subjects').then((d) => d.subjects));

export function matchSubjects(subjects, query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const compact = q.replace(/[\s-]+/g, '');
  const scored = [];
  for (const s of subjects) {
    const code = s.code.toLowerCase();
    const name = s.name.toLowerCase();
    let score = -1;
    if (code.startsWith(compact)) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(` ${q}`)) score = 2;
    else if (name.includes(q)) score = 3;
    if (score >= 0) scored.push([score, s]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].code.localeCompare(b[1].code))
    .slice(0, limit)
    .map(([, s]) => s);
}

let uid = 0;
export function attachCourseSuggest(input, onPick) {
  const id = `suggest-${++uid}`;
  const list = document.createElement('ul');
  list.className = 'suggest';
  list.id = id;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  input.after(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-controls', id);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  let items = [];
  let active = -1;
  let seq = 0; // bumped on every input and close, so a slow lookup can't reopen a dismissed list

  const close = () => {
    seq++;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const paint = () => {
    if (!items.length) {
      list.innerHTML = html`<li class="suggest-empty" role="option" aria-disabled="true">
        No course matches "${input.value.trim()}". Try the code from your timetable, like CS301.
      </li>`.value;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    list.innerHTML = items
      .map(
        (s, i) => html`<li role="option" id="${id}-${i}" data-i="${i}" aria-selected="${i === active}">
          <span class="code">${highlight(s.code, input.value)}</span>
          <span>${highlight(s.name, input.value)}</span>
        </li>`.value,
      )
      .join('');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${id}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  input.addEventListener('input', async () => {
    const mine = ++seq;
    const subjects = await loadSubjects();
    if (mine !== seq || document.activeElement !== input) return;
    items = matchSubjects(subjects, input.value);
    if (!input.value.trim()) return close();
    active = items.length ? 0 : -1; // first match is preselected; Enter opens it
    paint();
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return close();
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + items.length + 1) % (items.length + 1);
      if (active === items.length) active = -1;
      paint();
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      const picked = items[active];
      close();
      onPick(picked);
    }
  });

  // mousedown fires before the input's blur, so the pick isn't lost.
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    e.preventDefault();
    const picked = items[Number(li.dataset.i)];
    close();
    onPick(picked);
  });

  input.addEventListener('blur', close);
}
