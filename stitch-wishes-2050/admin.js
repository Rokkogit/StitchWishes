/* Stitch Wishess — back of house.

   Three states: checking, anon, authed. The session cookie is HttpOnly, so
   this file cannot read it and never sees the code after it is submitted —
   asking the server is the only way to know whether we are signed in. */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Long enough for the stitch to finish sewing before the panel replaces it.
// Matches the clip-path transition in admin.css.
const SEW_MS = REDUCED ? 0 : 600;

const panels = new Map(
  Array.from(document.querySelectorAll('[data-state]')).map((el) => [
    el.dataset.state,
    el,
  ])
);

const gateWrap = document.querySelector('[data-gate-wrap]');
const thread = document.querySelector('.gate__thread');
const bead = document.querySelector('[data-bead]');
const form = document.querySelector('[data-login]');
const input = document.querySelector('#code');
const errorBox = document.querySelector('[data-error]');
const submit = document.querySelector('[data-submit]');

let mounted = false;

/* ------------------------------------------------------------------ view */

function show(state) {
  for (const [name, el] of panels) el.hidden = name !== state;

  const signedIn = state === 'authed';
  thread.classList.toggle('is-sewn', signedIn);
  bead.classList.toggle('is-strung', signedIn);

  // The gate is a narrow centred column; the workroom is the full page. They
  // cannot share a wrapper, so the whole gate steps aside once you are in.
  gateWrap.hidden = signedIn;

  if (state === 'anon') input.focus();

  // Mount once. Re-mounting on every sign-in would stack event listeners and
  // discard the working draft.
  if (signedIn && !mounted) {
    mounted = true;
    window.StitchAdminCatalog?.mount();
  }
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = '';
  errorBox.hidden = true;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------- transport */

// Every failure mode here is something the person can act on, so each one gets
// its own sentence rather than a shared "something went wrong".
const OFFLINE =
  'Cannot reach the login service. If you are running this locally, it needs ' +
  '`vercel dev` rather than a plain file server.';

async function call(path, options) {
  let response;

  try {
    response = await fetch(path, { credentials: 'same-origin', ...options });
  } catch {
    throw new Error(OFFLINE);
  }

  // A plain static server answers /api/* with a 404 instead of refusing the
  // connection, so this is the same problem wearing a different hat.
  if (response.status === 404) throw new Error(OFFLINE);

  return response;
}

/* ---------------------------------------------------------------- session */

async function loadSession() {
  try {
    const response = await call('/api/admin-session', { method: 'GET' });
    const data = await response.json();

    show(data.authed ? 'authed' : 'anon');
  } catch (error) {
    show('anon');
    showError(error.message);
  }
}

async function signIn(event) {
  event.preventDefault();
  clearError();

  const code = input.value;
  if (!code) {
    showError('Enter your code first.');
    return;
  }

  submit.disabled = true;
  thread.classList.add('is-sewn');

  try {
    const response = await call('/api/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (response.ok) {
      bead.classList.add('is-strung');
      input.value = '';
      await sleep(SEW_MS);
      await loadSession();
      return;
    }

    thread.classList.remove('is-sewn');
    input.value = '';
    input.focus();

    const body = await response.json().catch(() => ({}));
    showError(body.error || 'That did not work. Try again.');
  } catch (error) {
    thread.classList.remove('is-sewn');
    showError(error.message);
  } finally {
    submit.disabled = false;
  }
}

async function signOut() {
  try {
    await call('/api/admin-logout', { method: 'POST' });
  } catch {
    // Nothing useful to say: the cookie is the session, and if the request
    // never landed the session is still live. loadSession reports the truth.
  }

  clearError();
  await loadSession();
}

/* -------------------------------------------------------------------- boot */

form.addEventListener('submit', signIn);
input.addEventListener('input', clearError);
document.querySelector('[data-logout]').addEventListener('click', signOut);

loadSession();
