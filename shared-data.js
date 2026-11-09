// Shared data helpers for the Darden Small Group Dinners pages.
//
// PROTOTYPE ONLY: everything is stored in this browser's localStorage, so
// accounts exist only on the computer where they were created and anyone with
// access to the browser could read or change them. A real version would sign
// students in with UVA NetBadge and keep data on a server.

const ACCOUNTS_KEY = 'darden-sgd-accounts';
const SESSION_KEY = 'darden-sgd-session';
const DARDEN_EMAIL = /^[^\s@]+@darden\.virginia\.edu$/i;
const MIN_PASSWORD_LENGTH = 8;

function readJson(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch (e) {
    // Storage unavailable (private window, blocked site data)
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// ---------- Accounts ----------

function loadAccounts() {
  return readJson(ACCOUNTS_KEY, []);
}

function findAccount(email) {
  const target = normalizeEmail(email);
  return loadAccounts().find(a => a.email === target) || null;
}

async function hashPassword(password, salt) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('This browser cannot create accounts here. Open the page from localhost or a file instead.');
  }
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function newSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Returns { ok: true, account } or { ok: false, errors: { field: message } }
async function createAccount(name, email, password, confirmPassword) {
  const errors = {};
  const cleanName = String(name || '').trim();
  const cleanEmail = normalizeEmail(email);

  if (!cleanName) errors.name = 'Please enter your name.';
  if (!DARDEN_EMAIL.test(cleanEmail)) {
    errors.email = 'Please use your Darden email (ending in @darden.virginia.edu).';
  } else if (findAccount(cleanEmail)) {
    errors.email = 'An account with this email already exists. Please log in instead.';
  }
  if (String(password || '').length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  } else if (password !== confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const salt = newSalt();
  const account = {
    name: cleanName,
    email: cleanEmail,
    salt,
    passwordHash: await hashPassword(password, salt),
    createdAt: new Date().toISOString()
  };

  const accounts = loadAccounts();
  accounts.push(account);
  if (!writeJson(ACCOUNTS_KEY, accounts)) {
    return { ok: false, errors: { form: 'Your browser blocked saving the account. Check that site data is allowed.' } };
  }
  writeJson(SESSION_KEY, { email: account.email });
  return { ok: true, account };
}

// Returns { ok: true, account } or { ok: false, error }
async function logIn(email, password) {
  const account = findAccount(email);
  // Same message whether the email or the password is wrong
  const failure = { ok: false, error: 'Email or password is incorrect.' };
  if (!account) return failure;
  if (await hashPassword(password, account.salt) !== account.passwordHash) return failure;
  writeJson(SESSION_KEY, { email: account.email });
  return { ok: true, account };
}

function logOut() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {
    // Nothing to clear
  }
}

function currentUser() {
  const session = readJson(SESSION_KEY, null);
  return session ? findAccount(session.email) : null;
}

// Only allow returning to one of our own pages after logging in
function safeNextPage(next) {
  return /^[\w-]+\.html(\?[\w=&%.-]*)?$/.test(next || '') ? next : null;
}

// Send logged-out visitors to the account page, then back here afterwards
function requireLogin() {
  const user = currentUser();
  if (!user) {
    const here = window.location.pathname.split('/').pop() + window.location.search;
    window.location.replace(`Account.html?next=${encodeURIComponent(here)}`);
  }
  return user;
}
