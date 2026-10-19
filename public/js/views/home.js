import { api, examYears, html, plural } from '../lib.js';
import { attachCourseSuggest } from '../suggest.js';
import { navigate } from '../app.js';

export async function homeView() {
  const { branches, totals } = await api('/branches');

  return {
    title: '',
    body: html`
      <section class="find">
        <form class="find-form" action="/search" role="search" aria-labelledby="find-title">
          <h1 class="line line-title" id="find-title"><span class="line-label"></span><span>Find a past paper</span></h1>
          <div class="line line-course">
            <label class="line-label" for="find-q">Course</label>
            <div class="line-field">
              <span class="blank">
                <input
                  id="find-q"
                  name="q"
                  type="text"
                  enterkeyhint="search"
                  placeholder="CS301 or Operating Systems"
                  autocomplete="off"
                  spellcheck="false"
                />
              </span>
              <button class="btn" type="submit">Search papers</button>
            </div>
          </div>
          <div class="line">
            <label class="line-label" for="find-year">Year</label>
            <div class="line-field">
              <select class="select" id="find-year" name="year">
                <option value="">Any year</option>
                ${examYears().map((y) => html`<option>${y}</option>`)}
              </select>
            </div>
          </div>
          <div class="line">
            <span class="line-label" id="find-exam">Exam</span>
            <div class="line-field">
              <div class="seg" role="radiogroup" aria-labelledby="find-exam">
                <label><input type="radio" name="type" value="" checked /><span>Both exams</span></label>
                <label><input type="radio" name="type" value="mid" /><span>Mid-sem</span></label>
                <label><input type="radio" name="type" value="end" /><span>End-sem</span></label>
              </div>
            </div>
          </div>
        </form>
      </section>
      <p class="find-note">
        ${plural(totals.papers, 'paper')} for ${plural(totals.subjects, 'course')} so far, uploaded by students
        and checked by admins.
      </p>

      <section class="browse">
        <h2 class="section-title">Browse by branch</h2>
        <ul class="branches">
          ${branches.map(
            (b) => html`<li>
              <a href="/branch/${b.code}">
                <span class="code">${b.code}</span>
                <span class="branch-name">${b.name}</span>
                <span class="count">${b.papers ? plural(b.papers, 'paper') : 'No papers yet'}</span>
              </a>
            </li>`,
          )}
        </ul>
        <p class="small muted" style="margin-top:14px">
          First-year courses are common to all branches and appear under 1st year in each one.
        </p>
      </section>
    `,
    mount(root) {
      const form = root.querySelector('.find-form');
      const input = form.elements.q;
      attachCourseSuggest(input, (subject) => navigate(`/course/${subject.code}`));
      // The full placeholder is cut off on phones.
      const narrow = matchMedia('(max-width: 479px)');
      const setPlaceholder = () => {
        input.placeholder = narrow.matches ? 'Course code or name' : 'CS301 or Operating Systems';
      };
      setPlaceholder();
      narrow.addEventListener('change', setPlaceholder);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const params = new URLSearchParams();
        for (const [k, v] of new FormData(form)) if (String(v).trim()) params.set(k, String(v).trim());
        navigate(`/search?${params}`);
      });
    },
  };
}
