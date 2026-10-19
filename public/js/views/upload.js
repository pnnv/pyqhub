import { api, examLabel, paperTitle, examYears, fileSize, html, session, shortDate, timeAgo } from '../lib.js';
import { attachCourseSuggest, loadSubjects } from '../suggest.js';
import { verifyPanel } from './account.js';

const MAX_MB = 20;

export async function uploadView({ query }) {
  const { user } = session;
  if (!user) {
    return {
      title: 'Upload a paper',
      body: html`<div class="margin page-head">
        <h1>Upload a paper</h1>
        <p class="lede">Sign in with your college account to upload. Admins check every paper before it goes up.</p>
        <p class="form-actions" style="margin-top:20px">
          <a class="btn" href="/signin?next=/upload">Sign in</a>
          <a class="btn btn-quiet" href="/signup?next=/upload">Create an account</a>
        </p>
      </div>`,
    };
  }

  if (!user.verified) {
    return {
      title: 'Upload a paper',
      body: html`<div class="margin page-head"><h1>Upload a paper</h1></div>
        <div class="margin" id="verify">
          ${verifyPanel(user.email)}
          <p style="margin-top:16px"><button class="btn btn-quiet" type="button" id="resend">Send the link again</button></p>
        </div>`,
      mount(root) {
        root.querySelector('#resend').addEventListener('click', async (e) => {
          e.target.disabled = true;
          const { devVerifyLink } = await api('/auth/resend', { method: 'POST' });
          root.querySelector('#verify').innerHTML = verifyPanel(user.email, devVerifyLink).value;
        });
      },
    };
  }

  const subjects = await loadSubjects();
  // Missing-paper slots link here with course, year and exam already chosen.
  const preset = subjects.find((s) => s.code === (query.get('course') ?? '').toUpperCase());
  const presetYear = examYears().includes(Number(query.get('year'))) ? Number(query.get('year')) : null;
  const presetExam = ['mid', 'end', 'quiz'].includes(query.get('exam')) ? query.get('exam') : null;
  const today = new Date().toISOString().slice(0, 10);

  return {
    title: 'Upload a paper',
    body: html`
      <div class="margin page-head">
        <h1>Upload a paper</h1>
        <p class="lede">One PDF per exam or quiz. An admin checks it for the right course, year and all pages, then it goes up for everyone.</p>
      </div>
      <div class="margin" id="upload">
        <form class="stack-form upload-form" novalidate>
          <div class="field course-field">
            <label for="course-input" class="field-label">Course</label>
            <input class="input" id="course-input" name="subject" autocomplete="off" spellcheck="false"
              placeholder="Type a code or name, like CS301" value="${preset?.code ?? ''}" required />
            <span class="hint course-picked">${preset ? preset.name : 'Pick the course from the list.'}</span>
          </div>

          <div class="field-row">
            <label class="field"><span>Exam year</span>
              <select class="select" name="exam_year" required>
                <option value="">Choose year</option>
                ${examYears().map((y) => html`<option ${y === presetYear ? 'selected' : ''}>${y}</option>`)}
              </select>
            </label>
            <fieldset class="field">
              <legend class="field-label">Exam</legend>
              <div class="seg">
                <label><input type="radio" name="exam_type" value="mid" required ${presetExam === 'mid' ? 'checked' : ''} /><span>Mid-sem</span></label>
                <label><input type="radio" name="exam_type" value="end" ${presetExam === 'end' ? 'checked' : ''} /><span>End-sem</span></label>
                <label><input type="radio" name="exam_type" value="quiz" ${presetExam === 'quiz' ? 'checked' : ''} /><span>Quiz</span></label>
              </div>
            </fieldset>
          </div>

          <div class="field-row quiz-fields" ${presetExam === 'quiz' ? '' : 'hidden'}>
            <label class="field field-grow"><span>Which quiz <span class="hint">optional</span></span>
              <input class="input" name="quiz_label" maxlength="40" placeholder="Quiz 2, or Surprise quiz" />
            </label>
            <label class="field"><span>Date held <span class="hint">optional</span></span>
              <input class="input" type="date" name="held_on" max="${today}" />
            </label>
          </div>

          <div class="field">
            <span class="field-label">Question paper PDF</span>
            <label class="drop">
              <input type="file" name="file" accept="application/pdf,.pdf" required />
              <span class="drop-text">Drop the PDF here or <u>choose a file</u></span>
              <span class="hint">Up to ${MAX_MB} MB. Scan all pages into one PDF.</span>
            </label>
          </div>

          <label class="field"><span>Note <span class="hint">optional</span></span>
            <input class="input" name="note" maxlength="200" placeholder="For example: makeup exam, or page 4 is faint" />
          </label>

          <div class="progress" hidden><span></span></div>
          <p class="form-error error" role="alert"></p>
          <div class="form-actions">
            <button class="btn" type="submit">Submit for review</button>
          </div>
        </form>
      </div>
    `,
    mount(root) {
      const form = root.querySelector('form');
      const courseInput = form.elements.subject;
      const picked = root.querySelector('.course-picked');
      const error = root.querySelector('.form-error');
      const drop = root.querySelector('.drop');
      const fileInput = form.elements.file;
      const dropText = root.querySelector('.drop-text');

      const describeCourse = () => {
        const code = courseInput.value.replace(/[\s-]+/g, '').toUpperCase();
        const match = subjects.find((s) => s.code === code);
        picked.textContent = match ? match.name : 'Pick the course from the list.';
        picked.classList.toggle('ok', Boolean(match));
        return match;
      };
      attachCourseSuggest(courseInput, (s) => {
        courseInput.value = s.code;
        describeCourse();
      });
      courseInput.addEventListener('input', describeCourse);
      describeCourse();

      // Quiz name and date only make sense for quizzes.
      const quizFields = root.querySelector('.quiz-fields');
      form.addEventListener('change', (e) => {
        if (e.target.name !== 'exam_type') return;
        quizFields.hidden = e.target.value !== 'quiz';
      });

      const showFile = () => {
        const file = fileInput.files[0];
        drop.classList.toggle('has-file', Boolean(file));
        dropText.textContent = file ? `${file.name}, ${fileSize(file.size)}` : 'Drop the PDF here or choose a file';
      };
      fileInput.addEventListener('change', showFile);
      drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('over');
      });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('over');
        if (e.dataTransfer.files.length) {
          fileInput.files = e.dataTransfer.files;
          showFile();
        }
      });

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        error.textContent = '';
        const file = fileInput.files[0];
        const isQuiz = form.elements.exam_type.value === 'quiz';
        const heldOn = form.elements.held_on.value;
        const problem = !describeCourse()
          ? 'Pick the course from the list.'
          : !form.elements.exam_year.value
            ? 'Choose the exam year.'
            : !form.querySelector('[name=exam_type]:checked')
              ? 'Choose mid-sem, end-sem or quiz.'
              : isQuiz && heldOn && heldOn.slice(0, 4) !== form.elements.exam_year.value
                ? `The quiz date is in ${heldOn.slice(0, 4)} but the exam year is ${form.elements.exam_year.value}.`
              : !file
                ? 'Attach the question paper PDF.'
                : !/\.pdf$/i.test(file.name) && file.type !== 'application/pdf'
                  ? 'That file is not a PDF.'
                  : file.size > MAX_MB * 1024 * 1024
                    ? `The PDF is larger than ${MAX_MB} MB. Compress it and try again.`
                    : '';
        if (problem) {
          error.textContent = problem;
          return;
        }
        send(root, form);
      });
    },
  };
}

// XHR rather than fetch so large scans show upload progress.
function send(root, form) {
  const button = form.querySelector('button[type=submit]');
  const progress = root.querySelector('.progress');
  const bar = progress.firstElementChild;
  const error = root.querySelector('.form-error');
  const data = new FormData(form);
  data.set('subject', form.elements.subject.value.replace(/[\s-]+/g, '').toUpperCase());
  if (data.get('exam_type') !== 'quiz') {
    data.delete('quiz_label');
    data.delete('held_on');
  }

  button.disabled = true;
  button.textContent = 'Uploading…';
  progress.hidden = false;
  bar.style.width = '0%';

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/papers');
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) bar.style.width = `${Math.round((e.loaded / e.total) * 100)}%`;
  };
  xhr.onload = () => {
    let body = {};
    try {
      body = JSON.parse(xhr.responseText);
    } catch {}
    if (xhr.status === 201) {
      const p = body.paper;
      root.querySelector('#upload').innerHTML = html`
        <div class="notice">
          <p><strong>Sent for review.</strong></p>
          <p>${p.subject_code} ${p.subject_name}, ${paperTitle(p)}. You'll see it marked approved under My uploads once an admin checks it.</p>
        </div>
        <p class="form-actions" style="margin-top:20px">
          <a class="btn" href="/upload">Upload another</a>
          <a class="btn btn-quiet" href="/my-uploads">My uploads</a>
        </p>`.value;
      return;
    }
    error.textContent = body.error ?? 'The upload failed. Check your connection and try again.';
    button.disabled = false;
    button.textContent = 'Submit for review';
    progress.hidden = true;
  };
  xhr.onerror = () => {
    error.textContent = 'The upload failed. Check your connection and try again.';
    button.disabled = false;
    button.textContent = 'Submit for review';
    progress.hidden = true;
  };
  xhr.send(data);
}

export const STATUS = {
  approved: ['Approved', 'approved'],
  pending: ['Pending review', 'pending'],
  rejected: ['Rejected', 'rejected'],
  superseded: ['Replaced', 'superseded'],
};

export const stamp = (status) => html`<span class="stamp stamp-${STATUS[status][1]}">${STATUS[status][0]}</span>`;

export async function myUploadsView() {
  if (!session.user) return { redirect: '/signin?next=/my-uploads' };
  const { papers } = await api('/me/uploads');
  const approved = papers.filter((p) => p.status === 'approved');
  const downloads = approved.reduce((n, p) => n + p.downloads, 0);

  return {
    title: 'My uploads',
    body: html`
      <div class="margin page-head">
        <h1>My uploads</h1>
        <p class="lede">
          ${papers.length
            ? `${approved.length} of ${papers.length} approved. Your papers have been downloaded ${downloads.toLocaleString('en-IN')} times.`
            : 'Papers you upload show up here with their review status.'}
        </p>
      </div>
      <div class="margin">
        ${papers.length
          ? html`<ul class="rows uploads">
              ${papers.map(
                (p) => html`<li class="upload-row">
                  <div>
                    <a class="paper-exam" href="/paper/${p.id}">${p.subject_code} ${paperTitle(p)}</a>
                    <p class="small muted">${p.subject_name}. Uploaded ${timeAgo(p.created_at)}, ${shortDate(p.created_at)}.</p>
                    ${p.status === 'rejected' ? html`<p class="small reject-reason">${p.reject_reason}</p>` : ''}
                  </div>
                  ${stamp(p.status)}
                </li>`,
              )}
            </ul>`
          : html`<p><a class="btn" href="/upload">Upload a paper</a></p>`}
      </div>
    `,
  };
}
