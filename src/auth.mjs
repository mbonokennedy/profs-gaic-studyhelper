// Offline sign-in for IO Offline. Accounts live on this device (users.json or the
// built-in demo accounts); passwords are scrypt-hashed; sessions are in memory and
// carried in an HttpOnly cookie. Nothing is sent to any server.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const COOKIE = 'io_offline_sess';
const TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// Demo accounts (fictional people). Override with USERS_FILE=path/to/users.json:
// [{ "email": "...", "name": "...", "role": "Learner", "grade": 10, "password": "..." }]
const DEMO_USERS = [
  { email: 'learner@in-odyssey.demo', name: 'Siyabonga Dlamini', role: 'Learner', grade: 10, password: 'Odyssey2026!' },
  { email: 'teacher@in-odyssey.demo', name: 'Thandi Mokoena', role: 'Teacher', grade: null, password: 'Odyssey2026!' },
];

const hash = (pw, salt) => scryptSync(pw, salt, 32);
const users = new Map();
function load() {
  const file = process.env.USERS_FILE;
  const list = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : DEMO_USERS;
  for (const u of list) {
    const salt = randomBytes(16);
    users.set(u.email.toLowerCase(), { email: u.email.toLowerCase(), name: u.name, role: u.role || 'Learner', grade: u.grade ?? null, salt, hash: hash(u.password, salt) });
  }
}
load();
export const usingDemoUsers = !process.env.USERS_FILE;
export const demoCredentials = usingDemoUsers ? { email: DEMO_USERS[0].email, password: DEMO_USERS[0].password } : null;

const sessions = new Map(); // token -> { user, expires }
const publicUser = (u) => ({ email: u.email, name: u.name, role: u.role, grade: u.grade });

export function verify(email, password) {
  const u = users.get(String(email || '').trim().toLowerCase());
  const salt = u?.salt ?? randomBytes(16);
  const got = hash(String(password || ''), salt);
  return u && timingSafeEqual(got, u.hash) ? publicUser(u) : null;
}

export function createSession(res, user) {
  const token = randomBytes(24).toString('base64url');
  sessions.set(token, { user, expires: Date.now() + TTL_MS });
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TTL_MS / 1000}`);
  return user;
}

export function currentUser(req) {
  const token = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const s = token && sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(token); return null; }
  s.expires = Date.now() + TTL_MS; // sliding expiry
  return s.user;
}

export function destroySession(req, res) {
  const token = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// Simple brute-force brake: 8 failed attempts per IP per 10 minutes.
const fails = new Map();
export function tooManyAttempts(ip) {
  const f = fails.get(ip);
  return f && f.count >= 8 && Date.now() - f.first < 10 * 60 * 1000;
}
export function recordFailure(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.first > 10 * 60 * 1000) fails.set(ip, { count: 1, first: Date.now() });
  else f.count++;
}
export const IO_GUEST = { email: 'io-session', name: 'IO Learner', role: 'Learner', grade: null };
