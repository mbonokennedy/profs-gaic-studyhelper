// IO Offline front-end (In-Odyssey look). No external scripts, fonts or CDNs.
const $ = (s, d = document) => d.querySelector(s);
const params = new URLSearchParams(location.search);
const EMBED = params.get('embed') === '1';
if (EMBED) document.body.classList.add('embed');
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

const state = {
  courses: [],
  courseId: store.get('io.course') || '',
  lessonId: '',
  mode: 'coach',
  messages: [],
  ioLesson: null,
  busy: false,
  lastSummary: '',
  user: null,
  languages: {},
};

// ── Helpers ──
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const delatex = (s) =>
  String(s)
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^{}]*)\}/g, '√($1)')
    .replace(/\\pm/g, '±').replace(/\\times/g, '×').replace(/\\cdot/g, '·').replace(/\\neq/g, '≠').replace(/\\leq?/g, '≤').replace(/\\geq?/g, '≥')
    .replace(/\^2(?![0-9])/g, '²').replace(/\^3(?![0-9])/g, '³')
    .replace(/\\[()[\]]/g, '').replace(/\$+/g, '').replace(/\\([a-zA-Z]+)/g, '$1');
const fmt = (s) => esc(delatex(s)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^\s*(?:[-*•]\s*)+/gm, '• ').replace(/^#+\s*/gm, '');
const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'IO';
const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
const toLogin = () => location.replace('/login');
async function api(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) toLogin();
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
async function stream(path, body, onEvent) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401) toLogin();
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Request failed (${r.status})`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (!line.startsWith('data:')) continue;
      const ev = JSON.parse(line.slice(5));
      if (ev.error) throw new Error(ev.error);
      onEvent(ev);
    }
  }
}
const selection = () => ({ courseId: state.courseId, lessonId: state.lessonId || undefined });
const materialBody = () => (state.ioLesson && !state.lessonId ? { title: state.ioLesson.title, text: state.ioLesson.text } : selection());
const currentCourse = () => state.courses.find((x) => x.id === state.courseId);
const currentLesson = () => currentCourse()?.lessons.find((x) => x.id === state.lessonId);
const topicName = () => currentLesson()?.title ?? (state.ioLesson && !state.lessonId ? state.ioLesson.title : currentCourse()?.name ?? 'this topic');

// ── Navigation: views, collapsible sidebar, drawer ──
const VIEWS = {
  home: ['Dashboard', 'Your offline study space.'],
  tutor: ['AI Tutor', 'Ask about your lessons. Answers are generated on this device.'],
  quiz: ['Practice Quiz', 'Test yourself on any lesson, marked instantly.'],
  summary: ['Summarise Lesson', 'Revision notes in seconds.'],
};
const isNarrow = () => matchMedia('(max-width: 900px)').matches;
function showView(name) {
  document.querySelectorAll('.side-nav button').forEach((b) => (b.dataset.view === name ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  document.querySelectorAll('.view').forEach((v) => v.toggleAttribute('data-active', v.id === `view-${name}`));
  $('#viewTitle').textContent = VIEWS[name][0];
  $('#viewSub').textContent = VIEWS[name][1];
  document.body.classList.remove('nav-open');
  window.scrollTo(0, 0);
}
document.querySelectorAll('.side-nav button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
if (store.get('io.sideCollapsed') === '1') document.body.classList.add('side-collapsed');
$('#sideToggle').addEventListener('click', () => {
  if (isNarrow()) return document.body.classList.toggle('nav-open');
  const c = document.body.classList.toggle('side-collapsed');
  store.set('io.sideCollapsed', c ? '1' : '0');
});
$('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
$('#courseRail').addEventListener('click', () => {
  document.body.classList.remove('side-collapsed');
  store.set('io.sideCollapsed', '0');
  setTimeout(() => $('#course').focus(), 220);
});

// User menu
$('#userBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const m = $('#userMenu');
  m.hidden = !m.hidden;
  $('#userBtn').setAttribute('aria-expanded', String(!m.hidden));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#userBox')) $('#userMenu').hidden = true;
  if (!e.target.closest('#searchBox') && !e.target.closest('#searchToggle')) closeSearch();
  if (!e.target.closest('#trPop') && !e.target.closest('#trFab') && !e.target.closest('#langBtn') && !e.target.closest('.qa')) closeTranslator();
});
$('#signOut').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  toLogin();
});

// Dashboard quick actions
document.querySelectorAll('.qa').forEach((b) =>
  b.addEventListener('click', () => {
    const go = b.dataset.go;
    if (go === 'translate') return openTranslator();
    if (go === 'voice') { showView('tutor'); return $('#micBtn').click(); }
    if (go === 'practice') { showView('tutor'); return practiceQuestion(); }
    showView(go);
  }),
);
$('#startLesson').addEventListener('click', () => showView('tutor'));

// ── Lesson search (navbar) ──
const search = $('#search'), results = $('#searchResults');
let hits = [], hitIdx = 0;
function closeSearch() {
  results.hidden = true;
  if (isNarrow()) $('#searchBox').classList.remove('open');
}
$('#searchToggle').addEventListener('click', () => {
  $('#searchBox').classList.add('open');
  search.focus();
});
search.addEventListener('input', () => {
  const q = search.value.trim().toLowerCase();
  if (q.length < 2) return (results.hidden = true);
  hits = [];
  for (const c of state.courses) for (const l of c.lessons) {
    const hay = `${l.title} ${l.module ?? ''} ${c.name}`.toLowerCase();
    if (hay.includes(q)) hits.push({ c, l });
  }
  hits = hits.slice(0, 8);
  hitIdx = 0;
  results.innerHTML = hits.length
    ? hits.map((h, i) => `<button type="button" data-i="${i}" class="${i === 0 ? 'active' : ''}"><span>${esc(h.l.title)}</span><small>${esc(h.c.name)}${h.l.module ? ` · ${esc(h.l.module)}` : ''}</small></button>`).join('')
    : '<div class="none">No lessons match.</div>';
  results.hidden = false;
});
search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { search.value = ''; closeSearch(); }
  if (e.key === 'Enter' && hits[hitIdx]) { e.preventDefault(); openLesson(hits[hitIdx]); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    hitIdx = (hitIdx + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % Math.max(hits.length, 1);
    results.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === hitIdx));
  }
});
results.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (b) openLesson(hits[+b.dataset.i]);
});
function openLesson({ c, l }) {
  setCourse(c.id, l.id);
  search.value = '';
  closeSearch();
  showView('tutor');
  toast(`Studying: ${l.title}`);
}

// ── User ──
async function loadUser() {
  const { user } = await api('/api/me');
  state.user = user;
  const first = user.name.split(' ')[0];
  $('#userName').textContent = user.name;
  $('#userRole').textContent = user.grade ? `${user.role} · Grade ${user.grade}` : user.role;
  $('#userAvatar').textContent = initials(user.name);
  $('#umName').textContent = user.name;
  $('#umEmail').textContent = user.email.includes('@') ? user.email : 'Signed in through IO';
  $('#greeting').textContent = `Hi ${first}, welcome back!`;
  $('#today').textContent = new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Status + dashboard stats ──
async function refreshStatus() {
  try {
    const h = await api('/api/health');
    const models = Object.values(h.models);
    // Only the tutor + search models gate "ready"; translators load on demand.
    const core = ['llm', 'embed'].map((k) => h.models[k]).filter(Boolean);
    const loading = !core.length || core.some((m) => m.status === 'loading');
    const err = models.find((m) => m.status === 'error');
    const el = $('#status');
    el.classList.toggle('ready', !loading && !err && models.length > 0);
    el.classList.toggle('error', !!err);
    const tps = h.tokensPerSecond ? ` · ${h.tokensPerSecond} tok/s` : '';
    $('#statusText').textContent = err ? 'Model error' : loading || !models.length ? 'Loading AI…' : `AI on-device${tps}`;
    el.title = models.map((m) => `${m.label}: ${m.name} (${m.status})`).join('\n') + (h.urls?.length ? `\n\nPhone: ${h.urls[0]}` : '');
    $('#stSpeed').textContent = h.tokensPerSecond ? `${h.tokensPerSecond} tok/s` : 'Ready';
    $('#stModel').textContent = h.llm.replace(/_/g, ' ').replace(/INST Q4.*$/, '').trim();
    if (!Object.keys(state.languages).length) buildLanguages(h.languages);
    return h;
  } catch {
    $('#statusText').textContent = 'Server offline';
    $('#status').className = 'status error';
  }
}
$('#status').addEventListener('click', async () => {
  const h = await refreshStatus();
  if (h) toast(`${h.llm} · ${h.courses} subjects · 0 bytes sent to the cloud`);
});

// ── Courses & lessons ──
const SUBJECT_COLOURS = ['#0E5C50', '#AD4FE3', '#D4AF37', '#2F6FD0', '#D9534F', '#16A34A', '#00A3A3', '#B8892B', '#6366F1'];
async function loadCourses() {
  state.courses = (await api('/api/courses')).filter((c) => c.lessons.length);
  const sel = $('#course');
  sel.innerHTML = '';
  for (const c of state.courses) sel.add(new Option(c.source === 'sample' ? `${c.name} (sample)` : c.name, c.id));
  const pc = params.get('course');
  const want = pc ? (state.courses.some((c) => c.id === pc) ? pc : `io-${pc}`) : state.courseId;
  const fallback = state.courses.find((c) => /^math/i.test(c.name)) ?? state.courses.find((c) => /math/i.test(c.name)) ?? state.courses[0];
  setCourse(state.courses.some((c) => c.id === want) ? want : fallback?.id || '');
  $('#stCourses').textContent = state.courses.length;
  $('#stLessons').textContent = state.courses.reduce((n, c) => n + c.lessons.length, 0);
  $('#subjectList').innerHTML = state.courses
    .map((c, i) => `<button type="button" class="subject" data-id="${esc(c.id)}"><span class="ic" style="background:${SUBJECT_COLOURS[i % SUBJECT_COLOURS.length]}" data-no-translate>${esc(initials(c.name))}</span><span><b data-no-translate>${esc(c.name)}</b><small>${c.lessons.length} lessons · offline</small></span></button>`)
    .join('');
}
$('#subjectList').addEventListener('click', (e) => {
  const b = e.target.closest('.subject');
  if (!b) return;
  setCourse(b.dataset.id);
  showView('tutor');
});
function setCourse(courseId, lessonId = '') {
  state.courseId = courseId;
  store.set('io.course', courseId);
  $('#course').value = courseId;
  fillLessons();
  if (lessonId) {
    state.lessonId = lessonId;
    $('#lesson').value = lessonId;
    labels();
  }
}
function labels() {
  const label = `“${topicName()}”`;
  $('#quizFor').textContent = `Multiple-choice questions from ${label}.`;
  $('#summaryFor').textContent = `Key points from ${label}.`;
  starters();
}
function fillLessons() {
  const sel = $('#lesson');
  sel.innerHTML = '<option value="">Whole course</option>';
  let lastModule, group = sel;
  for (const l of currentCourse()?.lessons ?? []) {
    if (l.module !== lastModule) {
      group = document.createElement('optgroup');
      group.label = l.module || 'Lessons';
      sel.appendChild(group);
      lastModule = l.module;
    }
    group.appendChild(new Option(l.title, l.id));
  }
  state.lessonId = '';
  labels();
}
$('#course').addEventListener('change', (e) => setCourse(e.target.value));
$('#lesson').addEventListener('change', (e) => {
  state.lessonId = e.target.value;
  labels();
});
function starters() {
  const topic = topicName();
  const chips = [`Explain ${topic} simply`, `Give me a practice question on ${topic}`, `What mistakes do learners make with ${topic}?`];
  $('#starterChips').innerHTML = chips.map((q) => `<button type="button" class="chip-q">${esc(q)}</button>`).join('');
}
$('#starterChips').addEventListener('click', (e) => {
  if (e.target.classList.contains('chip-q')) ask(e.target.textContent);
});

// ── Tutor chat ──
document.querySelectorAll('.mode button').forEach((b) =>
  b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    document.querySelectorAll('.mode button').forEach((x) => x.setAttribute('aria-pressed', x === b));
  }),
);
const q = $('#question');
q.addEventListener('input', () => {
  q.style.height = 'auto';
  q.style.height = `${Math.min(q.scrollHeight, 140)}px`;
});
q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    ask();
  }
});
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  ask();
});
const BOT_ICON = '<svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M8.5 13h.01M15.5 13h.01M9.5 16h5"/></svg>';
const ICON_LISTEN = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
const ICON_TR = '<svg viewBox="0 0 24 24"><path d="M4 5h9M8.5 3v2M6 5c1 4 4 7 7 8M11 5c-1 4-4 7-7 9M13 21l4-9 4 9M14.5 18h5"/></svg>';
function addMsg(role, text = '') {
  $('#chatEmpty')?.remove();
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = (role === 'bot' ? `<div class="who">${BOT_ICON}IO Tutor</div>` : '') + `<div class="body">${fmt(text)}</div>`;
  $('#chat').appendChild(el);
  el.scrollIntoView({ block: 'end', behavior: 'smooth' });
  return el;
}
function clearReplies() {
  document.querySelectorAll('.replies').forEach((r) => r.remove());
}
function addActions(bot, text, sources) {
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML =
    (sources?.length ? sources.map((s) => `<span class="src" title="match ${s.score}">${esc(s.title)}</span>`).join('') : '') +
    `<span class="acts"><button class="act listen" type="button">${ICON_LISTEN}Listen</button><button class="act tr" type="button">${ICON_TR}Translate</button></span>`;
  $('.listen', meta).addEventListener('click', (e) => speak(text, e.currentTarget));
  $('.tr', meta).addEventListener('click', (e) => inlineTranslate(bot, text, e.currentTarget));
  bot.appendChild(meta);
}
const PRACTICE_RE = /\b(practice question|quiz me|test me|give me a question|ask me a question|quick question)\b/i;

async function ask(preset) {
  const text = (preset ?? q.value).trim();
  if (!text || state.busy) return;
  clearReplies();
  if (!preset) { q.value = ''; q.style.height = 'auto'; }
  if (PRACTICE_RE.test(text)) {
    addMsg('user', text);
    return practiceQuestion();
  }
  state.busy = true;
  $('#sendBtn').disabled = true;
  addMsg('user', text);
  state.messages.push({ role: 'user', content: text });
  const bot = addMsg('bot');
  bot.classList.add('thinking');
  const body = $('.body', bot);
  let answer = '', sources = [];
  try {
    await stream('/api/chat', { ...selection(), mode: state.mode, messages: state.messages, lesson: state.ioLesson ?? undefined }, (ev) => {
      if (ev.sources) sources = ev.sources;
      if (ev.t) {
        answer += ev.t;
        body.innerHTML = fmt(answer.replace(/^\s+/, ''));
        bot.scrollIntoView({ block: 'end' });
      }
      if (ev.done) answer = ev.answer || answer;
    });
    body.innerHTML = fmt(answer);
    state.messages.push({ role: 'assistant', content: answer });
    addActions(bot, answer, sources);
    offerReplies(answer);
  } catch (err) {
    body.textContent = `Sorry: ${err.message}`;
    state.messages.pop();
  } finally {
    bot.classList.remove('thinking');
    state.busy = false;
    $('#sendBtn').disabled = false;
    refreshStatus();
  }
}

// Tappable replies: when the tutor asks something, offer answers to tap (no retyping).
function lastQuestion(text) {
  const qs = delatex(text).match(/[^.!?\n]*\?/g);
  return qs ? qs[qs.length - 1].trim() : '';
}
function replyBox(hint) {
  clearReplies();
  const box = document.createElement('div');
  box.className = 'replies';
  box.innerHTML = `<span class="hint">${esc(hint)}</span><div class="reply-row"></div>`;
  $('#chat').appendChild(box);
  return box;
}
function renderReplies(box, options, extras = []) {
  const row = $('.reply-row', box);
  row.innerHTML = '';
  for (const o of options) row.insertAdjacentHTML('beforeend', `<button type="button" class="reply">${esc(o)}</button>`);
  for (const x of extras) row.insertAdjacentHTML('beforeend', `<button type="button" class="reply ghost" data-act="${esc(x.act || '')}"${x.send ? ` data-send="${esc(x.send)}"` : ''}>${esc(x.label)}</button>`);
  row.addEventListener('click', (e) => {
    const b = e.target.closest('.reply');
    if (!b) return;
    const act = b.dataset.act;
    box.remove();
    if (act === 'practice') return practiceQuestion();
    ask(act ? b.dataset.send || b.textContent : b.textContent);
  });
  box.scrollIntoView({ block: 'end', behavior: 'smooth' });
}
async function offerReplies(answer) {
  const question = lastQuestion(answer);
  if (!question || question.length < 8) return;
  const box = replyBox('Tap an answer');
  $('.reply-row', box).innerHTML = '<span class="reply-skel"></span><span class="reply-skel"></span><span class="reply-skel"></span>';
  box.scrollIntoView({ block: 'end', behavior: 'smooth' });
  const extras = [{ label: 'I’m not sure, give me a hint', act: 'hint' }];
  try {
    const { options } = await api('/api/suggest', { question, ...selection(), lesson: state.ioLesson ?? undefined });
    if (!box.isConnected) return;
    renderReplies(box, shuffle(options), extras);
  } catch {
    if (box.isConnected) renderReplies(box, [], extras);
  }
}

// Practice question inside the chat: options are buttons, marked instantly.
async function practiceQuestion() {
  if (state.busy) return;
  state.busy = true;
  clearReplies();
  const bot = addMsg('bot', `Here’s a practice question on ${topicName()}. Tap your answer:`);
  bot.classList.add('thinking');
  try {
    const { questions } = await api('/api/quiz', { ...materialBody(), count: 1 });
    const qq = questions[0];
    bot.classList.remove('thinking');
    const card = document.createElement('div');
    card.className = 'card q mcq';
    card.innerHTML = `<h3>${esc(delatex(qq.question))}</h3><div class="opts">${qq.options.map((o, j) => `<button type="button" class="opt" data-j="${j}">${esc(delatex(o))}</button>`).join('')}</div>`;
    $('#chat').appendChild(card);
    card.scrollIntoView({ block: 'end', behavior: 'smooth' });
    $('.opts', card).addEventListener('click', (e) => {
      const b = e.target.closest('.opt');
      if (!b || b.disabled) return;
      const pick = +b.dataset.j, right = pick === qq.answerIndex;
      card.querySelectorAll('.opt').forEach((x) => {
        x.disabled = true;
        if (+x.dataset.j === qq.answerIndex) x.classList.add('correct');
      });
      if (!right) b.classList.add('wrong');
      const feedback = `${right ? '✓ Correct!' : `✗ Not quite. The answer is “${qq.options[qq.answerIndex]}”.`} ${qq.explanation}`;
      card.insertAdjacentHTML('beforeend', `<div class="explain">${esc(delatex(feedback))}</div>`);
      // Keep the exchange in the tutor's memory so follow-ups make sense.
      state.messages.push(
        { role: 'assistant', content: `Practice question: ${qq.question}\nOptions: ${qq.options.join(' | ')}` },
        { role: 'user', content: `My answer: ${qq.options[pick]}` },
        { role: 'assistant', content: feedback },
      );
      const box = replyBox('What next?');
      renderReplies(box, [], [
        { label: 'Another question', act: 'practice' },
        { label: 'Explain it step by step', act: 'explain', send: `Explain step by step why the answer to "${qq.question}" is "${qq.options[qq.answerIndex]}".` },
        ...(right ? [] : [{ label: 'Why was my answer wrong?', act: 'why', send: `Why is "${qq.options[pick]}" wrong for "${qq.question}"?` }]),
      ]);
    });
  } catch (err) {
    $('.body', bot).textContent = `Sorry: ${err.message}`;
  } finally {
    bot.classList.remove('thinking');
    state.busy = false;
    refreshStatus();
  }
}

// ── Text-to-speech (iOS needs a user gesture to unlock audio once) ──
const player = new Audio();
player.playsInline = true;
let unlocked = false;
document.addEventListener('pointerdown', () => {
  if (unlocked) return;
  unlocked = true;
  player.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  player.play().catch(() => {});
}, { capture: true });
let currentUrl;
async function speak(text, btn) {
  const label = btn?.lastChild;
  if (!player.paused && btn?.dataset.playing) {
    player.pause();
    delete btn.dataset.playing;
    if (label) label.textContent = label.dataset.prev || 'Listen';
    return;
  }
  if (label) { label.dataset.prev = label.dataset.prev || label.textContent; label.textContent = 'Preparing…'; }
  try {
    const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (r.status === 401) return toLogin();
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Speech failed');
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(await r.blob());
    player.src = currentUrl;
    await player.play();
    if (btn) btn.dataset.playing = '1';
    if (label) label.textContent = 'Stop';
    player.onended = () => {
      if (label) label.textContent = label.dataset.prev;
      if (btn) delete btn.dataset.playing;
    };
  } catch (err) {
    if (label) label.textContent = label.dataset.prev;
    toast(err.name === 'NotAllowedError' ? 'Tap Listen again to play audio.' : err.message);
  }
}

// ── Speech-to-text: record → 16 kHz mono WAV in the browser → QVAC Whisper ──
let recorder, chunks, micStream;
const mic = $('#micBtn');
mic.addEventListener('click', async () => {
  if (recorder?.state === 'recording') return recorder.stop();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return toast('Microphone needs HTTPS. Open the https:// link (see README), or use the keyboard 🎤 dictation key.', 6000);
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch {
    return toast('Microphone permission was denied.');
  }
  chunks = [];
  recorder = new MediaRecorder(micStream);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    micStream.getTracks().forEach((t) => t.stop());
    mic.classList.remove('recording');
    mic.classList.add('busy');
    try {
      const wav = await toWav16k(new Blob(chunks, { type: recorder.mimeType }));
      const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (!data.text) return toast('I did not catch that. Try again a little closer to the mic.');
      ask(data.text);
    } catch (err) {
      toast(`Voice failed: ${err.message}`);
    } finally {
      mic.classList.remove('busy');
    }
  };
  recorder.start();
  mic.classList.add('recording');
  toast('Listening… tap the mic again to stop.', 2500);
});
async function toWav16k(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close?.();
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

// ── Quiz ──
$('#quizBtn').addEventListener('click', async () => {
  const btn = $('#quizBtn'), out = $('#quizOut');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  out.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const { questions, ms } = await api('/api/quiz', { ...materialBody(), count: +$('#quizCount').value });
    let answered = 0, correct = 0;
    out.innerHTML = '';
    questions.forEach((qq, i) => {
      const card = document.createElement('div');
      card.className = 'card q';
      card.innerHTML = `<h3><span class="n">${i + 1}</span>${esc(delatex(qq.question))}</h3><div class="opts">${qq.options
        .map((o, j) => `<button type="button" class="opt" data-j="${j}">${esc(delatex(o))}</button>`).join('')}</div>`;
      $('.opts', card).addEventListener('click', (e) => {
        const b = e.target.closest('.opt');
        if (!b || b.disabled) return;
        const pick = +b.dataset.j;
        card.querySelectorAll('.opt').forEach((x) => {
          x.disabled = true;
          if (+x.dataset.j === qq.answerIndex) x.classList.add('correct');
        });
        if (pick !== qq.answerIndex) b.classList.add('wrong');
        else correct++;
        answered++;
        card.insertAdjacentHTML('beforeend', `<div class="explain">${pick === qq.answerIndex ? '✓ Correct. ' : '✗ Not quite. '}${esc(delatex(qq.explanation))}</div>`);
        if (answered === questions.length) out.insertAdjacentHTML('beforeend', `<div class="score">Score: ${correct} / ${questions.length}${correct === questions.length ? ' 🎉' : ''}</div>`);
      });
      out.appendChild(card);
    });
    toast(`${questions.length} questions generated on-device in ${(ms / 1000).toFixed(1)}s`);
  } catch (err) {
    out.innerHTML = `<div class="card">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate quiz';
    refreshStatus();
  }
});

// ── Summary ──
$('#summaryBtn').addEventListener('click', async () => {
  const btn = $('#summaryBtn'), out = $('#summaryOut');
  btn.disabled = true;
  btn.textContent = 'Summarising…';
  out.hidden = false;
  out.classList.add('thinking');
  $('#summaryActions').hidden = true;
  out.innerHTML = '';
  let text = '';
  try {
    await stream('/api/summary', materialBody(), (ev) => {
      if (ev.t) {
        text += ev.t;
        out.innerHTML = fmt(text.trimStart());
      }
      if (ev.done) text = ev.answer || text;
    });
    out.innerHTML = fmt(text);
    state.lastSummary = text;
    $('#summaryActions').hidden = false;
  } catch (err) {
    out.textContent = err.message;
  } finally {
    out.classList.remove('thinking');
    btn.disabled = false;
    btn.textContent = 'Summarise';
    refreshStatus();
  }
});
$('#summarySpeak').addEventListener('click', (e) => speak(state.lastSummary, e.currentTarget));

// ── Page-level translation (like IO's translate button) ──
// Walks the page's visible text, sends it to the on-device translator, swaps it in place,
// and keeps translating new content (tutor answers, quizzes) as it appears.
const PT = { lang: 'en', orig: new WeakMap(), shown: new WeakMap(), cache: new Map(), timer: null, running: false, again: false };
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SVG', 'NOSCRIPT']);
function skipNode(el) {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName) || e.hasAttribute?.('data-no-translate') || e.classList?.contains('thinking') || e.namespaceURI === 'http://www.w3.org/2000/svg') return true;
  }
  return false;
}
function collect() {
  const nodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (/\p{L}{2,}/u.test(n.nodeValue) && !skipNode(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let n; (n = walker.nextNode());) nodes.push(n);
  const attrs = [...document.querySelectorAll('[placeholder],[title]')].filter((el) => !skipNode(el));
  return { nodes, attrs };
}
const cacheFor = (lang) => (PT.cache.has(lang) ? PT.cache.get(lang) : PT.cache.set(lang, new Map()).get(lang));
function originalOf(node) {
  if (PT.shown.get(node) === node.nodeValue && PT.orig.has(node)) return PT.orig.get(node);
  PT.orig.set(node, node.nodeValue); // new or changed by the app → this is the new original
  return node.nodeValue;
}
async function translatePage() {
  if (PT.lang === 'en') return;
  if (PT.running) { PT.again = true; return; }
  PT.running = true;
  const lang = PT.lang, cache = cacheFor(lang), label = state.languages[lang]?.label ?? lang;
  try {
    const { nodes, attrs } = collect();
    const items = nodes.map((n) => { const o = originalOf(n); return { n, o, key: o.trim() }; });
    const attrItems = [];
    for (const el of attrs) for (const a of ['placeholder', 'title']) {
      if (!el.hasAttribute(a)) continue;
      const ds = `tr${a}`;
      const cur = el.getAttribute(a);
      if (el.dataset[`${ds}Shown`] !== cur) el.dataset[`${ds}Orig`] = cur;
      attrItems.push({ el, a, key: el.dataset[`${ds}Orig`].trim() });
    }
    const missing = [...new Set([...items, ...attrItems].map((i) => i.key).filter((k) => k && !cache.has(k)))];
    const apply = () => {
      if (PT.lang !== lang) return;
      for (const { n, o, key } of items) {
        const t = cache.get(key);
        if (!t) continue;
        const v = o.replace(key, t);
        if (n.nodeValue !== v) n.nodeValue = v;
        PT.shown.set(n, v);
      }
      for (const { el, a, key } of attrItems) {
        const t = cache.get(key);
        if (!t) continue;
        el.setAttribute(a, t);
        el.dataset[`tr${a}Shown`] = t;
      }
    };
    apply();
    if (missing.length) {
      $('#trFab').classList.add('busy');
      for (let i = 0; i < missing.length && PT.lang === lang; i += 40) {
        const batch = missing.slice(i, i + 40);
        setBar(`Translating to ${label}… ${Math.min(i + batch.length, missing.length)}/${missing.length}`);
        const { translations } = await api('/api/translate-page', { texts: batch, lang });
        batch.forEach((k, j) => cache.set(k, translations[j] || k));
        apply();
      }
    }
    if (PT.lang === lang) setBar(`This page is in ${label}. Translated on your device.`);
  } catch (err) {
    toast(`Translation failed: ${err.message}`);
  } finally {
    $('#trFab').classList.remove('busy');
    PT.running = false;
    if (PT.again) { PT.again = false; schedulePage(); }
  }
}
function schedulePage() {
  clearTimeout(PT.timer);
  PT.timer = setTimeout(translatePage, 500);
}
function revertPage() {
  const { nodes, attrs } = collect();
  for (const n of nodes) if (PT.shown.get(n) === n.nodeValue && PT.orig.has(n)) n.nodeValue = PT.orig.get(n);
  for (const el of attrs) for (const a of ['placeholder', 'title']) {
    const o = el.dataset[`tr${a}Orig`];
    if (o != null && el.getAttribute(a) === el.dataset[`tr${a}Shown`]) el.setAttribute(a, o);
  }
}
function setBar(text) {
  $('#trBar').hidden = !text;
  $('#trBarText').textContent = text || '';
}
function setLanguage(lang) {
  if (lang === PT.lang) return closeTranslator();
  revertPage();
  PT.lang = lang;
  store.set('io.lang', lang);
  document.documentElement.lang = lang;
  $('#langLabel').textContent = lang === 'en' ? 'English' : state.languages[lang]?.label ?? lang;
  document.querySelectorAll('.lang-opt').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  closeTranslator();
  if (lang === 'en') return setBar('');
  translatePage();
}
new MutationObserver(() => PT.lang !== 'en' && schedulePage()).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
$('#trBarOriginal').addEventListener('click', () => setLanguage('en'));

function buildLanguages(langs) {
  state.languages = langs;
  const btn = (code, l) => `<button type="button" class="lang-opt" data-lang="${code}" aria-pressed="false"><span>${esc(l.label)}</span><small>${esc(l.sa ? 'South Africa' : l.native)}</small></button>`;
  $('#langSa').innerHTML = Object.entries(langs).filter(([, l]) => l.sa).map(([c, l]) => btn(c, l)).join('');
  $('#langOther').innerHTML = Object.entries(langs).filter(([, l]) => !l.sa).map(([c, l]) => btn(c, l)).join('');
  $('#stLangs').textContent = Object.keys(langs).length + 1;
  document.querySelectorAll('.lang-opt').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === PT.lang));
    b.addEventListener('click', () => setLanguage(b.dataset.lang));
  });
}
const pop = $('#trPop'), fab = $('#trFab');
function openTranslator() {
  pop.hidden = false;
  fab.setAttribute('aria-expanded', 'true');
}
function closeTranslator() {
  pop.hidden = true;
  fab.setAttribute('aria-expanded', 'false');
}
fab.addEventListener('click', () => (pop.hidden ? openTranslator() : closeTranslator()));
$('#langBtn').addEventListener('click', () => (pop.hidden ? openTranslator() : closeTranslator()));
$('#trClose').addEventListener('click', closeTranslator);
document.addEventListener('keydown', (e) => e.key === 'Escape' && !pop.hidden && closeTranslator());

// Translate one answer inline (into the page language, or isiZulu by default).
async function inlineTranslate(bot, text, btn) {
  const lang = PT.lang !== 'en' ? PT.lang : store.get('io.inlineLang') || 'zu';
  const label = state.languages[lang]?.label ?? lang;
  let box = $('.inline-tr', bot);
  if (box) return box.remove();
  box = document.createElement('div');
  box.className = 'inline-tr';
  box.setAttribute('data-no-translate', '');
  box.innerHTML = `<small>${esc(label)}</small><span>Translating…</span>`;
  bot.appendChild(box);
  btn.disabled = true;
  try {
    const r = await api('/api/translate', { text: delatex(text), lang });
    $('span', box).textContent = r.text;
  } catch (err) {
    $('span', box).textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

// ── IO integration: the IO lesson page posts its lesson into this iframe ──
window.addEventListener('message', async (e) => {
  const d = e.data;
  if (!d || d.type !== 'io-lesson' || !d.text) return;
  state.ioLesson = { title: d.title || 'Current lesson', text: String(d.text).slice(0, 20000), courseId: d.courseId };
  $('#ioBanner').hidden = false;
  $('#ioLessonTitle').textContent = state.ioLesson.title;
  labels();
  api('/api/ingest', { courseId: 'io-live', courseName: 'From IO (live)', lessonId: d.lessonId, title: state.ioLesson.title, text: state.ioLesson.text }).catch(() => {});
});
if (EMBED && window.parent !== window) window.parent.postMessage({ type: 'io-offline-ready' }, '*');

// ── Boot ──
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
await loadUser().catch(() => toLogin());
showView(EMBED ? 'tutor' : 'home');
await refreshStatus();
await loadCourses().catch((e) => toast(e.message));
const savedLang = store.get('io.lang');
if (savedLang && savedLang !== 'en' && state.languages[savedLang]) setLanguage(savedLang);
setInterval(refreshStatus, 8000);
