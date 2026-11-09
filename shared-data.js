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

// ---------- Dinners ----------
//
// Event shape: { id, theme, dateTime, location, capacity, filled, hostEmail, signups }
// signups: [{ name, email, seats, family, diet, signedUpAt }]

const EVENTS_KEY = 'darden-sgd-events-v2';

// Demo accounts so reviewers can test the hosting rule (password: dinner123).
// demo.guest has attended 3 dinners and hosted none, so is at the limit.
// demo.host has hosted one dinner that already happened, so can attend 6.
const demoAccounts = [
  {
    name: 'Demo Guest',
    email: 'demo.guest@darden.virginia.edu',
    salt: 'demo-salt-guest',
    passwordHash: '8cf72898fa19288e5601aaee974e64e31dbacd8babe5b415e5e1e04098ec5b2b',
    createdAt: '2026-10-01T12:00:00.000Z'
  },
  {
    name: 'Demo Host',
    email: 'demo.host@darden.virginia.edu',
    salt: 'demo-salt-host',
    passwordHash: 'd6d9eda1eeb4e70b326b732d52050e4733efcc3888fdff731c4ce96916732ea4',
    createdAt: '2026-10-01T12:00:00.000Z'
  }
];

function demoSignup(name, email) {
  return { name, email, seats: 1, family: '', diet: 'None', signedUpAt: '2026-10-15T12:00:00.000Z' };
}

const defaultEvents = [
  {
    id: 100,
    theme: "Summer Internship Stories",
    dateTime: "2026-11-02T19:00",
    location: "Pavilion IX, West Lawn",
    capacity: 6,
    filled: 5,
    hostEmail: "demo.host@darden.virginia.edu",
    signups: [demoSignup('Demo Guest', 'demo.guest@darden.virginia.edu')]
  },
  {
    id: 101,
    theme: "Tech & Strategy Career Paths",
    dateTime: "2026-11-12T19:00",
    location: "Pavilion IX, West Lawn",
    capacity: 6,
    filled: 4,
    hostEmail: "demo.host@darden.virginia.edu",
    signups: []
  },
  {
    id: 102,
    theme: "Navigating Case Method & Cold Calls",
    dateTime: "2026-11-15T18:30",
    location: "Ivy Road Apartments Common Room",
    capacity: 5,
    filled: 5,
    hostEmail: "demo.host@darden.virginia.edu",
    signups: []
  },
  {
    id: 103,
    theme: "International Student Connections",
    dateTime: "2026-11-18T19:30",
    location: "North Grounds Apartment Clubhouse",
    capacity: 6,
    filled: 2,
    hostEmail: "classmate.a@darden.virginia.edu",
    signups: [
      demoSignup('Demo Guest', 'demo.guest@darden.virginia.edu'),
      demoSignup('Demo Host', 'demo.host@darden.virginia.edu')
    ]
  },
  {
    id: 104,
    theme: "Consulting Recruiting: Lessons from SYs",
    dateTime: "2026-11-20T18:00",
    location: "Pavilion IX, West Lawn",
    capacity: 4,
    filled: 1,
    hostEmail: "classmate.b@darden.virginia.edu",
    signups: [demoSignup('Demo Host', 'demo.host@darden.virginia.edu')]
  },
  {
    id: 105,
    theme: "Entrepreneurship & Startup Ideas",
    dateTime: "2026-12-02T20:00",
    location: "iLab Conference Room",
    capacity: 8,
    filled: 3,
    hostEmail: "classmate.a@darden.virginia.edu",
    signups: [
      demoSignup('Demo Guest', 'demo.guest@darden.virginia.edu'),
      demoSignup('Demo Host', 'demo.host@darden.virginia.edu')
    ]
  },
  {
    id: 106,
    theme: "Family Life During the MBA",
    dateTime: "2026-12-05T17:30",
    location: "Ivy Road Apartments Common Room",
    capacity: 6,
    filled: 0,
    hostEmail: "classmate.c@darden.virginia.edu",
    signups: []
  }
];

function loadEvents() {
  return readJson(EVENTS_KEY, null) || JSON.parse(JSON.stringify(defaultEvents));
}

function saveEvents(events) {
  writeJson(EVENTS_KEY, events);
}

// Make sure the demo accounts exist (without touching anyone else's account)
function ensureDemoAccounts() {
  const accounts = loadAccounts();
  const missing = demoAccounts.filter(d => !accounts.some(a => a.email === d.email));
  if (missing.length > 0) writeJson(ACCOUNTS_KEY, accounts.concat(missing));
}

// Restore the sample dinners. Accounts and the current login are kept.
function resetDemoData() {
  saveEvents(JSON.parse(JSON.stringify(defaultEvents)));
  ensureDemoAccounts();
}

ensureDemoAccounts();

// ---------- Hosting rule (story 9) ----------
//
// New students can attend 3 dinners before hosting. Each dinner they host
// unlocks 3 more, but only once it has taken place. A sign-up counts once per
// dinner, however many family seats it includes.

const FREE_DINNERS = 3;
const DINNERS_PER_HOSTED = 3;

function dinnerAllowance(email, events = loadEvents()) {
  const me = normalizeEmail(email);
  const now = new Date();
  const attended = events.filter(e => (e.signups || []).some(s => normalizeEmail(s.email) === me)).length;
  const hostedHeld = events.filter(e => normalizeEmail(e.hostEmail) === me && new Date(e.dateTime) <= now).length;
  const allowed = FREE_DINNERS + DINNERS_PER_HOSTED * hostedHeld;
  return { attended, hostedHeld, allowed, remaining: Math.max(0, allowed - attended) };
}

// Signing up again for a dinner you're already in doesn't use up another dinner
function isSignedUpFor(email, event) {
  const me = normalizeEmail(email);
  return (event.signups || []).some(s => normalizeEmail(s.email) === me);
}
