// `npm run smoke`: end-to-end check of every API against a running server (npm start).
// Works fully offline. Uses only the bundled sample course.
const B = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`;
const C = 'sample-grade-10-maths', L = '01-quadratic-equations';
let fail = 0;
async function step(name, fn) {
  const t = Date.now();
  try {
    const info = await fn();
    console.log(`  ✔ ${name.padEnd(12)} ${String(Date.now() - t).padStart(6)} ms  ${info ?? ''}`);
  } catch (e) {
    fail++;
    console.log(`  ✖ ${name.padEnd(12)} ${e.message}`);
  }
}
let cookie = '';
const post = (p, body, type = 'application/json') =>
  fetch(B + p, { method: 'POST', headers: { 'Content-Type': type, cookie }, body: type === 'application/json' ? JSON.stringify(body) : body });
const json = async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status); return d; };
const sseFinal = async (r) => { const t = await r.text(); if (!r.ok) throw new Error(t); const done = t.split('\n\n').map((l) => l.slice(5).trim()).filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.done || e.error); if (!done || done.error) throw new Error(done?.error || 'no answer'); return done; };

console.log(`\nIO Offline smoke test → ${B}\n`);
await step('auth gate', async () => {
  const r = await fetch(`${B}/`, { redirect: 'manual' });
  if (r.status !== 302) throw new Error(`expected redirect to /login, got ${r.status}`);
  const a = await post('/api/chat', { messages: [{ role: 'user', content: 'hi' }] });
  if (a.status !== 401) throw new Error(`expected 401 without session, got ${a.status}`);
  return 'app and AI endpoints require sign-in';
});
await step('login', async () => {
  const { demo } = await (await fetch(`${B}/api/login-hint`)).json();
  const email = process.env.SMOKE_EMAIL || demo?.email, password = process.env.SMOKE_PASSWORD || demo?.password;
  if (!email) throw new Error('set SMOKE_EMAIL / SMOKE_PASSWORD (USERS_FILE in use)');
  const bad = await post('/api/login', { email, password: 'wrong' });
  if (bad.status !== 401) throw new Error('wrong password was accepted');
  const r = await post('/api/login', { email, password });
  const d = await json(r);
  cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return `${d.user.name} (${d.user.role})`;
});
await step('health', async () => { const h = await json(await fetch(`${B}/api/health`)); return `${h.llm}, ${h.courses} courses`; });
await step('courses', async () => { const c = await json(await fetch(`${B}/api/courses`)); if (!c.find((x) => x.id === C)) throw new Error('sample course missing: run npm run sync-io'); return `${c.length} courses`; });
await step('chat', async () => { const d = await sseFinal(await post('/api/chat', { courseId: C, mode: 'coach', messages: [{ role: 'user', content: 'Solve x² − 5x + 6 = 0 for me' }] })); return JSON.stringify(d.answer.slice(0, 70)) + '…'; });
await step('summary', async () => { const d = await sseFinal(await post('/api/summary', { courseId: C, lessonId: L })); return `${d.answer.length} chars`; });
await step('quiz', async () => { const d = await json(await post('/api/quiz', { courseId: C, lessonId: L, count: 2 })); const q = d.questions[0]; return `${d.questions.length} Qs, e.g. "${q.question.slice(0, 40)}…" → ${q.options[q.answerIndex]}`; });
await step('suggest', async () => { const d = await json(await post('/api/suggest', { question: 'What two numbers multiply to +6 and add to −5?' })); if (!d.options?.length) throw new Error('no options'); return d.options.join(' | '); });
await step('translate zu', async () => { const d = await json(await post('/api/translate-page', { texts: ['Practice Quiz', 'Ask a question…'], lang: 'zu' })); return d.translations.join(' | ') + ` (${d.fromCache}/2 cached)`; });
await step('translate', async () => { const d = await json(await post('/api/translate', { text: 'Practice a little every day.', lang: 'fr' })); return d.text; });
let wav;
await step('tts', async () => { const r = await post('/api/tts', { text: 'The discriminant tells you the nature of the roots.' }); if (!r.ok) throw new Error(await r.text()); wav = Buffer.from(await r.arrayBuffer()); return `${(wav.length / 1024).toFixed(0)} KB wav`; });
await step('transcribe', async () => {
  // resample the TTS output to 16 kHz mono, as the browser does
  const sr = wav.readUInt32LE(24), n = (wav.length - 44) / 2, out = Math.floor((n * 16000) / sr), o = Buffer.alloc(44 + out * 2);
  wav.copy(o, 0, 0, 44); o.writeUInt32LE(36 + out * 2, 4); o.writeUInt32LE(16000, 24); o.writeUInt32LE(32000, 28); o.writeUInt32LE(out * 2, 40);
  for (let i = 0; i < out; i++) o.writeInt16LE(wav.readInt16LE(44 + Math.min(n - 1, Math.floor((i * sr) / 16000)) * 2), 44 + i * 2);
  const d = await json(await post('/api/transcribe', o, 'audio/wav'));
  if (!/discriminant/i.test(d.text)) throw new Error(`unexpected transcript: ${d.text}`);
  return JSON.stringify(d.text);
});
console.log(fail ? `\n${fail} check(s) failed.\n` : '\nAll checks passed.\n');
process.exit(fail ? 1 : 0);
