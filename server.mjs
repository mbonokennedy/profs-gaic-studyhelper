// IO Offline server: on-device AI (QVAC SDK) + PWA for PC, iPhone and the IO LMS.
import express from 'express';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import selfsigned from 'selfsigned';
import qrcode from 'qrcode-terminal';
import { close } from '@qvac/sdk';
import * as ai from './src/ai.mjs';
import { loadStore, listCourses, getLesson, getCourse, upsertCourse, search } from './src/rag.mjs';
import { ioAvailable, readIoCourses, readSampleCourses } from './src/io-connector.mjs';
import { MODELS, TRANSLATION_LANGS } from './src/models.mjs';
import * as auth from './src/auth.mjs';
import * as i18n from './src/i18n.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const HTTP_PORT = +(process.env.PORT || 8787);
const HTTPS_PORT = +(process.env.HTTPS_PORT || 8788);
// Origins allowed to embed IO Offline in an iframe (the IO LMS dev server by default).
const IO_ORIGINS = (process.env.IO_ORIGIN || 'http://127.0.0.1:1029 http://localhost:1029').split(/[\s,]+/).filter(Boolean);

const lanIps = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i.address);

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${IO_ORIGINS.join(' ')}`);
  res.setHeader('Permissions-Policy', 'microphone=(self)');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.json({ limit: '2mb' }));

// ── Sign-in (offline, on-device accounts) ──
const selfOrigins = () => [`http://localhost:${HTTP_PORT}`, `http://127.0.0.1:${HTTP_PORT}`, `https://localhost:${HTTPS_PORT}`, `https://127.0.0.1:${HTTPS_PORT}`,
  ...lanIps().flatMap((ip) => [`http://${ip}:${HTTP_PORT}`, `https://${ip}:${HTTPS_PORT}`])];
const refererOrigin = (req) => { try { return new URL(req.headers.referer).origin; } catch { return ''; } };

app.post('/api/login', (req, res) => {
  const ip = req.socket.remoteAddress;
  if (auth.tooManyAttempts(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const user = auth.verify(req.body?.email, req.body?.password);
  if (!user) { auth.recordFailure(ip); return res.status(401).json({ error: 'That email and password don’t match.' }); }
  res.json({ user: auth.createSession(res, user) });
});
app.post('/api/logout', (req, res) => { auth.destroySession(req, res); res.json({ ok: true }); });
app.get('/api/login-hint', (req, res) => res.json({ demo: auth.demoCredentials }));

// The app page needs a session. Embedded inside IO (or the demo LMS), the host page
// has already signed the learner in, so an embed request whose parent is an allowed
// IO origin gets an "IO Learner" session.
const sendApp = (res) => res.sendFile(join(ROOT, 'public', 'index.html'), { headers: { 'Cache-Control': 'no-store' } });
app.get(['/', '/index.html'], (req, res) => {
  if (auth.currentUser(req)) return sendApp(res);
  const parent = refererOrigin(req);
  if (req.query.embed === '1' && (IO_ORIGINS.includes(parent) || selfOrigins().includes(parent))) {
    auth.createSession(res, auth.IO_GUEST);
    return sendApp(res);
  }
  res.redirect(302, '/login');
});
app.get('/login', (req, res, next) => (auth.currentUser(req) ? res.redirect(302, '/') : next()));
app.get('/api/me', (req, res) => {
  const user = auth.currentUser(req);
  return user ? res.json({ user }) : res.status(401).json({ error: 'Not signed in' });
});
// AI endpoints need a session; health, course list and lesson text stay public (content only).
const PUBLIC_API = new Set(['/api/health', '/api/courses', '/api/lesson']);
app.use('/api', (req, res, next) => {
  if (PUBLIC_API.has(req.baseUrl + req.path) || auth.currentUser(req)) return next();
  res.status(401).json({ error: 'Please sign in.' });
});

app.use(express.static(join(ROOT, 'public'), { extensions: ['html'], index: false }));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(`✖ ${req.method} ${req.path}:`, err?.message ?? err);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: String(err?.message ?? err) })}\n\n`);
      return res.end();
    }
    res.status(err?.status ?? 500).json({ error: String(err?.message ?? err) });
  });

function sse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  return (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/** Resolve lesson material from {courseId, lessonId} or an explicit {title, text}. */
function material(body) {
  if (body.text?.trim()) return { title: body.title || 'Pasted text', text: body.text };
  const l = body.courseId && body.lessonId ? getLesson(body.courseId, body.lessonId) : null;
  if (l) return { title: l.title, text: l.text };
  const c = body.courseId ? getCourse(body.courseId) : null;
  if (c) return { title: c.name, text: c.lessons.map((x) => `${x.title}\n${x.text}`).join('\n\n').slice(0, 6000) };
  throw Object.assign(new Error('Pick a lesson or paste some text first.'), { status: 400 });
}

// ── API ──
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    offline: true,
    llm: MODELS.llm.name,
    tokensPerSecond: ai.lastStats.tokensPerSecond,
    models: ai.modelState,
    courses: listCourses().length,
    languages: Object.fromEntries(Object.entries(TRANSLATION_LANGS).map(([k, v]) => [k, { label: v.label, native: v.native, sa: !!v.sa }])),
    urls: lanIps().map((ip) => `https://${ip}:${HTTPS_PORT}`),
  });
});

app.get('/api/courses', (req, res) => res.json(listCourses()));

app.get('/api/lesson', (req, res) => {
  const l = getLesson(req.query.courseId, req.query.lessonId);
  if (!l) return res.status(404).json({ error: 'Lesson not found' });
  res.json(l);
});

app.post('/api/chat', wrap(async (req, res) => {
  const { courseId, lessonId, mode = 'coach', messages = [], lesson } = req.body;
  const turns = messages.filter((m) => ['user', 'assistant'].includes(m.role) && m.content).slice(-8);
  const question = [...turns].reverse().find((m) => m.role === 'user')?.content;
  if (!question) return res.status(400).json({ error: 'Ask a question first.' });

  let context = [];
  if (lesson?.text) context.push({ lessonTitle: lesson.title || 'Current IO lesson', text: lesson.text.slice(0, 2500), score: 1 });
  const hits = await search(question, { courseId, topK: lesson?.text ? 2 : 4 });
  context.push(...hits);
  if (!context.length && lessonId) {
    const l = getLesson(courseId, lessonId);
    if (l) context.push({ lessonTitle: l.title, text: l.text.slice(0, 2000), score: 1 });
  }

  const send = sse(res);
  const sources = [...new Map(context.map((c) => [c.lessonTitle, { title: c.lessonTitle, lessonId: c.lessonId, score: +(c.score ?? 1).toFixed(2) }])).values()];
  send({ sources });
  const t0 = Date.now();
  const answer = await ai.generate({
    system: ai.tutorSystem({ mode, context, courseName: getCourse(courseId)?.name, messages: turns }),
    messages: mode === 'explain' ? turns : ai.coachMessages(turns),
    onToken: (t) => send({ t }),
  });
  send({ done: true, answer, ms: Date.now() - t0, tokensPerSecond: ai.lastStats.tokensPerSecond });
  res.end();
}));

app.post('/api/summary', wrap(async (req, res) => {
  const m = material(req.body);
  const send = sse(res);
  const answer = await ai.summarize({ ...m, onToken: (t) => send({ t }) });
  send({ done: true, answer, tokensPerSecond: ai.lastStats.tokensPerSecond });
  res.end();
}));

app.post('/api/quiz', wrap(async (req, res) => {
  const m = material(req.body);
  const t0 = Date.now();
  const questions = await ai.generateQuiz({ ...m, count: req.body.count ?? 4 });
  res.json({ title: m.title, questions, ms: Date.now() - t0 });
}));

app.post('/api/translate', wrap(async (req, res) => {
  const { text, lang = 'fr' } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Nothing to translate.' });
  if (!TRANSLATION_LANGS[lang]) return res.status(400).json({ error: `Unsupported language "${lang}"` });
  const t0 = Date.now();
  res.json({ text: await ai.translate(text.slice(0, 4000), lang), lang, ms: Date.now() - t0 });
}));

// Page-level translation: the browser sends the page's visible strings, gets them back translated.
app.post('/api/translate-page', wrap(async (req, res) => {
  const { texts, lang } = req.body;
  if (!Array.isArray(texts) || texts.length > 300) return res.status(400).json({ error: 'Send 1–300 strings.' });
  const t0 = Date.now();
  const r = await i18n.translateTexts(texts.map((t) => String(t).slice(0, 600)), lang);
  res.json({ ...r, lang, ms: Date.now() - t0 });
}));

// Tappable answer options for the tutor's last question.
app.post('/api/suggest', wrap(async (req, res) => {
  const { question, courseId, lessonId, lesson } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'No question.' });
  const l = lesson?.text ? lesson : lessonId ? getLesson(courseId, lessonId) : null;
  res.json({ options: await ai.suggestReplies({ question: question.slice(0, 600), context: l?.text }) });
}));

app.post('/api/transcribe', express.raw({ type: () => true, limit: '25mb' }), wrap(async (req, res) => {
  if (!req.body?.length) return res.status(400).json({ error: 'No audio received.' });
  const t0 = Date.now();
  res.json({ text: await ai.transcribe(req.body), ms: Date.now() - t0 });
}));

app.post('/api/tts', wrap(async (req, res) => {
  const text = String(req.body.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'Nothing to say.' });
  const wav = await ai.speak(text);
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'no-store');
  res.end(wav);
}));

// Lesson text pushed from an IO page (or any app): indexed so later questions can find it.
app.post('/api/ingest', wrap(async (req, res) => {
  const { courseId = 'io-live', courseName = 'From IO (live)', lessonId, title, text } = req.body;
  if (!text?.trim() || text.trim().length < 40) return res.status(400).json({ error: 'Lesson text too short.' });
  const id = lessonId ? String(lessonId) : `l-${Buffer.from(title || text.slice(0, 40)).toString('base64url').slice(0, 16)}`;
  const r = await upsertCourse({ id: courseId, name: courseName, source: 'IO live', replace: false, lessons: [{ id, title: title || 'Untitled lesson', module: 'IO', text: text.slice(0, 20000) }] });
  res.json({ ...r, lessonId: id });
}));

app.post('/api/sync', wrap(async (req, res) => {
  res.json(await syncContent());
}));

async function syncContent() {
  const courses = [...(ioAvailable() ? readIoCourses() : []), ...(await readSampleCourses())];
  for (const c of courses) await upsertCourse(c);
  return { courses: courses.length };
}

// ── HTTPS certificate for LAN (Safari only allows the microphone on HTTPS) ──
function loadCert() {
  const dir = join(ROOT, 'certs');
  const ips = lanIps();
  const metaFile = join(dir, 'meta.json');
  if (existsSync(metaFile)) {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    if (ips.every((ip) => meta.ips.includes(ip)) && Date.now() < meta.expires) {
      return { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
    }
  }
  mkdirSync(dir, { recursive: true });
  const allIps = [...new Set([...ips, '127.0.0.1'])];
  const pems = selfsigned.generate([{ name: 'commonName', value: 'IO Offline (local)' }], {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 2, value: os.hostname() }, ...allIps.map((ip) => ({ type: 7, ip }))] },
    ],
  });
  writeFileSync(join(dir, 'key.pem'), pems.private);
  writeFileSync(join(dir, 'cert.pem'), pems.cert);
  writeFileSync(metaFile, JSON.stringify({ ips: allIps, expires: Date.now() + 360 * 864e5 }));
  return { key: pems.private, cert: pems.cert };
}

// ── Boot ──
await loadStore();
const portError = (port) => (err) => {
  console.error(`\n  ✖ Port ${port} is unavailable (${err.code}). Another app is using it.\n    Pick another: $env:PORT=9000; $env:HTTPS_PORT=9001; npm start\n`);
  process.exit(1);
};
http.createServer(app).on('error', portError(HTTP_PORT)).listen(HTTP_PORT, '0.0.0.0');
https.createServer(loadCert(), app).on('error', portError(HTTPS_PORT)).listen(HTTPS_PORT, '0.0.0.0');

const ips = lanIps();
console.log('\n  IO Offline: on-device AI study companion (QVAC SDK)\n');
console.log(`  PC:      http://localhost:${HTTP_PORT}`);
for (const ip of ips) console.log(`  Phone:   https://${ip}:${HTTPS_PORT}   (same Wi-Fi / hotspot)`);
if (ips[0]) {
  console.log('\n  Scan with the iPhone camera:');
  qrcode.generate(`https://${ips[0]}:${HTTPS_PORT}`, { small: true }, (q) => console.log(q.replace(/^/gm, '    ')));
}
console.log(`  Loading ${MODELS.llm.name} + ${MODELS.embed.name} ...`);
const t0 = Date.now();
await ai.warmup();
console.log(`  Models: ${Object.values(ai.modelState).map((m) => `${m.name}=${m.status}`).join(', ')} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
if (!listCourses().length) {
  console.log('  No courses indexed yet. Syncing IO + sample content ...');
  const r = await syncContent().catch((e) => ({ error: e.message }));
  console.log('  Sync:', r);
}
console.log(`  Ready. ${listCourses().length} courses available offline.\n`);
// Pre-translate the app's interface into the South African languages in the background
// (cached in data/i18n, so this is a one-off per language).
if (process.env.I18N_WARM !== '0') {
  const dyn = listCourses().flatMap((c) => [
    `${c.lessons.length} lessons · offline`,
    `Explain ${c.name} simply`, `Give me a practice question on ${c.name}`, `What mistakes do learners make with ${c.name}?`,
    `Multiple-choice questions from “${c.name}”.`, `Key points from “${c.name}”.`,
  ]);
  i18n.warmUi((m) => console.log(`  ${m}`), dyn).catch(() => {});
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log('\n  Shutting down...');
    await close?.().catch(() => {});
    process.exit(0);
  });
}
