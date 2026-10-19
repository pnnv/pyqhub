import { api, html, session } from '../lib.js';
import { navigate, refreshSession, renderMasthead } from '../app.js';

const safeNext = (query) => {
  const next = query.get('next') ?? '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
};

function bindForm(root, onSubmit) {
  const form = root.querySelector('form');
  const error = root.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    error.textContent = '';
    try {
      await onSubmit(Object.fromEntries(new FormData(form)));
    } catch (err) {
      error.textContent = err.message;
      button.disabled = false;
    }
  });
}

export function signinView({ query }) {
  if (session.user) return { redirect: safeNext(query) };
  const next = safeNext(query);
  return {
    title: 'Sign in',
    body: html`
      <div class="margin page-head">
        <h1>Sign in</h1>
        <p class="lede">You need an account to upload papers. Browsing and downloading are open to everyone.</p>
      </div>
      <div class="margin">
        <form class="stack-form" novalidate>
          <label class="field"><span>College email</span>
            <input class="input" name="email" type="email" autocomplete="email" required placeholder="name.rollno@nitk.edu.in" />
          </label>
          <label class="field"><span>Password</span>
            <input class="input" name="password" type="password" autocomplete="current-password" required />
          </label>
          <p class="form-error error" role="alert"></p>
          <div class="form-actions">
            <button class="btn" type="submit">Sign in</button>
            <span class="small muted">New here? <a href="/signup${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}">Create an account</a></span>
          </div>
        </form>
      </div>
    `,
    mount(root) {
      bindForm(root, async (data) => {
        await api('/auth/login', { method: 'POST', body: data });
        await refreshSession();
        navigate(next, { replace: true });
      });
    },
  };
}

export const verifyPanel = (email, devLink) => html`
  <div class="notice">
    <p><strong>Confirm your email to start uploading.</strong></p>
    <p>We sent a link to ${email}. Open it on any device, then come back here.</p>
    ${devLink
      ? html`<p class="small muted" style="margin-top:10px">Email isn't set up on this server, so here is the link: <a href="${devLink}">${devLink}</a></p>`
      : ''}
  </div>`;

export function signupView({ query }) {
  if (session.user) return { redirect: safeNext(query) };
  return {
    title: 'Create an account',
    body: html`
      <div class="margin page-head">
        <h1>Create an account</h1>
        <p class="lede">Use your NITK email. It keeps uploads to students of the college.</p>
      </div>
      <div class="margin" id="signup">
        <form class="stack-form" novalidate>
          <label class="field"><span>Full name</span>
            <input class="input" name="name" autocomplete="name" required />
          </label>
          <div class="field">
            <label for="signup-email" class="field-label">College email</label>
            <input class="input" id="signup-email" name="email" type="email" autocomplete="email" required
              placeholder="name.rollno@${session.emailDomain ?? 'nitk.edu.in'}" aria-describedby="signup-email-error" />
            <p class="error field-error" id="signup-email-error"></p>
          </div>
          <label class="field"><span>Password <span class="hint">at least 8 characters</span></span>
            <input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required />
          </label>
          <p class="form-error error" role="alert"></p>
          <div class="form-actions">
            <button class="btn" type="submit">Create account</button>
            <span class="small muted">Have an account? <a href="/signin">Sign in</a></span>
          </div>
        </form>
      </div>
    `,
    mount(root) {
      const email = root.querySelector('#signup-email');
      const emailError = root.querySelector('#signup-email-error');
      const domain = session.emailDomain ?? 'nitk.edu.in';
      const showEmailError = (message) => {
        emailError.textContent = message;
        email.setAttribute('aria-invalid', message ? 'true' : 'false');
      };
      const checkEmail = () => {
        const value = email.value.trim().toLowerCase();
        const ok = !value || value.endsWith(`@${domain}`);
        showEmailError(ok ? '' : `Use your college email ending in @${domain}.`);
        return ok;
      };
      email.addEventListener('blur', checkEmail);
      // clear the message as soon as the address becomes valid, without nagging mid-typing
      email.addEventListener('input', () => email.getAttribute('aria-invalid') === 'true' && checkEmail());

      bindForm(root, async (data) => {
        // email problems are shown under the field, so the form-level message stays empty
        if (!checkEmail()) {
          email.focus();
          throw new Error('');
        }
        const { user, devVerifyLink } = await api('/auth/signup', { method: 'POST', body: data }).catch((err) => {
          if (/email/i.test(err.message)) {
            showEmailError(err.message);
            email.focus();
            throw new Error('');
          }
          throw err;
        });
        session.user = user;
        renderMasthead();
        root.querySelector('#signup').innerHTML = verifyPanel(user.email, devVerifyLink).value;
      });
    },
  };
}

export async function verifyView({ params }) {
  try {
    const { user } = await api('/auth/verify', { method: 'POST', body: { token: params.token } });
    session.user = user;
    return {
      title: 'Email confirmed',
      body: html`<div class="margin page-head">
        <h1>Email confirmed</h1>
        <p class="lede">Thanks, ${user.name}. You can upload papers now.</p>
        <p style="margin-top:20px"><a class="btn" href="/upload">Upload a paper</a></p>
      </div>`,
    };
  } catch (err) {
    return {
      title: 'Link not valid',
      body: html`<div class="margin page-head">
        <h1>This link didn't work</h1>
        <p class="lede">${err.message} ${session.user ? html`<a href="/upload">Request a new link</a> from the upload page.` : html`<a href="/signin">Sign in</a> to request a new one.`}</p>
      </div>`,
    };
  }
}
