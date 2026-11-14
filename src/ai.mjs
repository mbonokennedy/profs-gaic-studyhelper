// IO Offline: all on-device AI calls go through this module (QVAC SDK).
import { loadModel, completion, embed, transcribe as qTranscribe, textToSpeech, translate as qTranslate } from '@qvac/sdk';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MODELS, TRANSLATION_LANGS, modelSrc } from './models.mjs';

// ── Model registry: load lazily, keep resident, report state for /api/health ──
const loaded = new Map(); // key -> Promise<modelId>
export const modelState = {}; // key -> { status, label, name, ms, error }

function load(key, name, label, extra = {}) {
  if (loaded.has(key)) return loaded.get(key);
  const t0 = Date.now();
  modelState[key] = { status: 'loading', label, name };
  const p = loadModel({ modelSrc: modelSrc(name), ...extra })
    .then((id) => {
      modelState[key] = { status: 'ready', label, name, ms: Date.now() - t0 };
      return id;
    })
    .catch((err) => {
      loaded.delete(key);
      modelState[key] = { status: 'error', label, name, error: String(err?.message ?? err) };
      throw err;
    });
  loaded.set(key, p);
  return p;
}

const llm = () => load('llm', MODELS.llm.name, MODELS.llm.label, { modelConfig: { ctx_size: 4096 } });
const embedder = () => load('embed', MODELS.embed.name, MODELS.embed.label);
const asr = () =>
  load('asr', MODELS.asr.name, MODELS.asr.label, {
    modelConfig: {
      audio_format: 's16le',
      strategy: 'greedy',
      n_threads: 4,
      language: 'en',
      no_timestamps: true,
      suppress_blank: true,
      suppress_nst: true,
      temperature: 0.0,
    },
  });
const tts = () =>
  load('tts', MODELS.tts.name, MODELS.tts.label, {
    modelConfig: { ttsEngine: 'supertonic', language: 'en', voice: 'F1', ttsSpeed: 1.05, ttsNumInferenceSteps: 5 },
  });
const translator = (lang) => {
  const l = TRANSLATION_LANGS[lang];
  if (!l) throw new Error(`Unsupported language "${lang}"`);
  if (l.engine === 'afri') return afri();
  return load(`tr_${lang}`, l.model, `Translate EN→${l.label}`, {
    modelConfig: { engine: 'Bergamot', from: 'en', to: lang, beamsize: 1, normalize: 1 },
  });
};
// One AfriSLM model serves every South African language.
const afri = () =>
  load('afri', MODELS.afri.name, MODELS.afri.label, {
    modelConfig: { ctx_size: 1024, temp: 0, top_k: 1, top_p: 1, repeat_penalty: 1, seed: 42, predict: 200 },
  });

export async function warmup() {
  await Promise.allSettled([llm(), embedder()]);
}

// ── One job at a time per model (small laptop; keeps latency predictable) ──
const queues = new Map();
function serial(key, fn) {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  return next;
}

// ── LLM helpers ──
const stripThink = (s) => s.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/g, '').trim();

export const lastStats = { tokensPerSecond: null, model: MODELS.llm.name };

/** Stream a completion; calls onToken(text) for each content delta. Returns final text. */
export function generate({ system, messages, onToken, maxTokens = 380, temp = 0.4, responseFormat }) {
  return serial('llm', async () => {
    const modelId = await llm();
    const history = [{ role: 'system', content: `${system}\n/no_think` }, ...messages];
    const run = completion({
      modelId,
      history,
      stream: true,
      generationParams: { temp, predict: maxTokens },
      ...(responseFormat ? { responseFormat } : {}),
    });
    let text = '';
    let inThink = false;
    for await (const ev of run.events) {
      if (ev.type !== 'contentDelta' || !ev.text) continue;
      // Some builds surface <think> tags inside content; hide them from the UI.
      let chunk = ev.text;
      if (chunk.includes('<think>')) inThink = true;
      if (inThink) {
        if (chunk.includes('</think>')) {
          inThink = false;
          chunk = chunk.split('</think>').pop();
        } else continue;
      }
      text += chunk;
      onToken?.(chunk);
    }
    const final = await run.final;
    if (final?.stats?.tokensPerSecond) lastStats.tokensPerSecond = +final.stats.tokensPerSecond.toFixed(1);
    return stripThink(final?.contentText ?? text);
  });
}

// ── Prompts ──
const BASE =
  'You are IO Offline, a friendly study companion inside the IO learning platform for South African high-school learners. ' +
  'You run entirely on this device with no internet. Use clear, simple English and short paragraphs. ' +
  'Write maths as plain text (x², √, ≠, ±, a/b). NEVER use LaTeX, $ signs or backslashes.';

const COACH_RULES =
  'COACH MODE (like a good tutor, adapted from IO\'s hint-ladder policy):\n' +
  '- NEVER give the final answer or a full solution in your first reply to a problem. Give ONE hint only.\n' +
  '- Hint ladder, one rung per reply: concept that applies → method / first move → work only the first step → full solution only after the learner has tried at least twice.\n' +
  '- If the learner just wants a concept explained (not a problem solved), explain it briefly.\n' +
  '- Max 70 words. End with ONE short question for the learner.\n\n' +
  'Example\nLearner: Solve 2x + 6 = 10 for me\nYou: Good one to practise! This is a linear equation, so the goal is to get x on its own. ' +
  'What could you do to both sides to remove the +6?';

/**
 * Small models follow examples and *recent* instructions far better than system rules.
 * For coach mode we prepend one demo exchange and append a hidden reminder to the latest
 * learner turn. Returns the message list to send to the model (the UI never sees it).
 */
export function coachMessages(turns) {
  const userTurns = turns.filter((m) => m.role === 'user').length;
  const demo = [
    { role: 'user', content: 'Solve 2x + 6 = 10 for me' },
    { role: 'assistant', content: 'Good one to practise! This is a linear equation, so the goal is to get x on its own. What could you do to both sides to remove the +6?' },
  ];
  const out = [...demo, ...turns.map((m) => ({ ...m }))];
  const last = out[out.length - 1];
  if (last?.role === 'user') {
    last.content +=
      userTurns < 3
        ? '\n\n[Tutor reminder: if this is a problem to solve, reply with ONE hint and ONE question only. Do not show the answer or the full working. Under 60 words.]'
        : '\n\n[Tutor reminder: the learner has tried several times; you may now show the worked solution step by step, then ask them to explain it back.]';
  }
  return out;
}

/** Coach mode is far more reliable on small models if the hint ladder is shown, not just described. */
export function coachPrimer(messages) {
  const userTurns = messages.filter((m) => m.role === 'user').length;
  return `\n\nThe learner has sent ${userTurns} message(s) in this conversation.${userTurns < 3 ? ' Do NOT reveal the final answer yet.' : ''}`;
}

const EXPLAIN_RULES = 'EXPLAIN MODE: Give a clear, direct explanation with one short example. Keep it under 120 words.';

export function tutorSystem({ mode, context, courseName, messages = [] }) {
  const ctx = context?.length
    ? `\n\nCOURSE MATERIAL from "${courseName ?? 'the course'}" (use it; if the answer is not in it, say so briefly and answer from general knowledge):\n` +
      context.map((c, i) => `[${i + 1}] (${c.lessonTitle}) ${c.text}`).join('\n')
    : '';
  return mode === 'explain' ? `${BASE}\n\n${EXPLAIN_RULES}${ctx}` : `${BASE}\n\n${COACH_RULES}${ctx}${coachPrimer(messages)}`;
}

/** Small models sometimes repeat their bullet list or emit decorative lines; tidy that up. */
function tidySummary(s) {
  const seen = new Set();
  const out = [];
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (/^[•·.\-*\s]+$/.test(t) && t) continue; // "• • • •"
    const key = t.replace(/^[•\-*]\s*/, '').toLowerCase();
    if (key && /^[•\-*]/.test(t) && seen.has(key)) continue; // duplicate bullet
    if (key) seen.add(key);
    out.push(line);
  }
  // drop a second "Key points:" block if the model restarted the list
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function summarize({ title, text, onToken }) {
  return tidySummary(await generateSummary({ title, text, onToken }));
}

function generateSummary({ title, text, onToken }) {
  return generate({
    system: `${BASE}\nSummarise lesson material for revision. Output: a 2-sentence overview, then "Key points:" with 4-6 bullet points starting with "• ", then "Remember:" with one memorable tip.`,
    messages: [{ role: 'user', content: `Lesson: ${title || 'Untitled'}\n\n${text.slice(0, 6000)}` }],
    onToken,
    maxTokens: 450,
    temp: 0.3,
  });
}

const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        // The model writes the correct answer text and 3 distractors; the server
        // shuffles and computes answerIndex (small models get indices wrong).
        properties: {
          question: { type: 'string' },
          correct: { type: 'string' },
          distractors: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
          explanation: { type: 'string' },
        },
        required: ['question', 'correct', 'distractors', 'explanation'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

function parseQuiz(raw) {
  const s = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  const obj = JSON.parse(s);
  const qs = (obj.questions ?? [])
    .filter((q) => q?.question && q.correct && Array.isArray(q.distractors) && q.distractors.length >= 1)
    .map((q) => {
      const wrong = [...new Set(q.distractors.map(String))].filter((d) => d.trim().toLowerCase() !== String(q.correct).trim().toLowerCase()).slice(0, 3);
      const options = [...wrong];
      const answerIndex = Math.floor(Math.random() * (options.length + 1));
      options.splice(answerIndex, 0, String(q.correct));
      return { question: q.question, options, answerIndex, explanation: q.explanation ?? '' };
    })
    .filter((q) => q.options.length >= 2);
  if (!qs.length) throw new Error('Model returned no usable questions');
  return qs;
}

export async function generateQuiz({ title, text, count = 4 }) {
  const n = Math.max(1, Math.min(8, count));
  const ask = (strict) =>
    generate({
      system: `${BASE}\nYou write multiple-choice revision questions. For each question give the correct answer in "correct", three plausible but WRONG answers in "distractors", and a one-sentence explanation of why the correct answer is right. Questions must be answerable from the material. Reply ONLY with JSON.`,
      messages: [{ role: 'user', content: `Write ${n} questions about this lesson.\nLesson: ${title || 'Untitled'}\n\n${text.slice(0, 5000)}` }],
      maxTokens: 260 * n,
      temp: strict ? 0.2 : 0.5,
      responseFormat: { type: 'json_schema', json_schema: { name: 'quiz', schema: QUIZ_SCHEMA } },
    });
  try {
    return parseQuiz(await ask(false)).slice(0, n);
  } catch {
    return parseQuiz(await ask(true)).slice(0, n); // one retry, cooler temperature
  }
}

// ── Tappable replies to the tutor's last question ──
const SUGGEST_SCHEMA = {
  type: 'object',
  properties: { options: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 } },
  required: ['options'],
  additionalProperties: false,
};
export async function suggestReplies({ question, context }) {
  const raw = await generate({
    system:
      `${BASE}\nA tutor just asked a learner a question. Write exactly 3 short, clearly DIFFERENT answers the learner could tap ` +
      '(each under 9 words, written as the learner): the first is correct, the second is a common mistake, the third is a different wrong or partial answer. ' +
      'Give concrete answers (numbers, terms, steps), not instructions. Reply ONLY with JSON.',
    messages: [
      { role: 'user', content: 'Tutor’s question: What two numbers multiply to +6 and add to −5?' },
      { role: 'assistant', content: '{"options":["−2 and −3","2 and 3","−1 and −6"]}' },
      { role: 'user', content: 'Tutor’s question: Which organelle releases energy from glucose?' },
      { role: 'assistant', content: '{"options":["The mitochondrion","The chloroplast","The nucleus"]}' },
      { role: 'user', content: `${context ? `Lesson context: ${context.slice(0, 1200)}\n\n` : ''}Tutor’s question: ${question}` },
    ],
    maxTokens: 120,
    temp: 0.3,
    responseFormat: { type: 'json_schema', json_schema: { name: 'replies', schema: SUGGEST_SCHEMA } },
  });
  const obj = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  // Drop near-duplicates (same words in a different order / one word changed).
  const words = (s) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s−-]/gu, '').split(/\s+/).filter(Boolean));
  const similar = (a, b) => { const A = words(a), B = words(b); const inter = [...A].filter((w) => B.has(w)).length; return inter / Math.max(A.size, B.size, 1) > 0.7; };
  const out = [];
  for (const s of (obj.options ?? []).map((x) => String(x).trim()).filter((x) => x && x.length < 90)) {
    if (!out.some((o) => similar(o, s))) out.push(s);
  }
  return out.slice(0, 3);
}

// ── Embeddings ──
export function embedTexts(texts) {
  return serial('embed', async () => {
    const modelId = await embedder();
    const out = [];
    for (let i = 0; i < texts.length; i += 16) {
      const { embedding } = await embed({ modelId, text: texts.slice(i, i + 16) });
      out.push(...embedding);
    }
    return out;
  });
}

// ── Speech-to-text: accepts a 16 kHz mono 16-bit WAV (browser converts) ──
export function transcribe(wavBuffer) {
  return serial('asr', async () => {
    const modelId = await asr();
    // Strip the 44-byte WAV header → raw s16le PCM, which whisper.cpp reads directly.
    const pcm = wavBuffer.subarray(0, 4).toString() === 'RIFF' ? wavBuffer.subarray(44) : wavBuffer;
    const file = join(tmpdir(), `io-offline-${randomUUID()}.raw`);
    await writeFile(file, pcm);
    try {
      const text = await qTranscribe({ modelId, audioChunk: file });
      const clean = String(text).replace(/\[[^\]]*\]/g, '').trim();
      return clean;
    } finally {
      unlink(file).catch(() => {});
    }
  });
}

// ── Text-to-speech → WAV buffer ──
function wavHeader(dataLength, sampleRate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataLength, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataLength, 40);
  return h;
}

export function speak(text) {
  return serial('tts', async () => {
    const modelId = await tts();
    const clean = text.replace(/[*#_`>•]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 900);
    const r = textToSpeech({ modelId, text: clean, inputType: 'text', stream: false });
    const samples = await r.buffer;
    const rate = (await r.sampleRate) || 44100;
    const pcm = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] ?? 0))), i * 2);
    return Buffer.concat([wavHeader(pcm.length, rate), pcm]);
  });
}

// ── Translation (EN → target) ──
// Short strings (UI labels, sentences). Bergamot handles a whole batch in one call;
// AfriSLM translates one string per call, so its jobs go through a priority queue:
// what the learner just asked for runs before background warm-up of UI strings.
const afriQueue = { high: [], low: [], running: false };
function afriJob(fn, priority) {
  return new Promise((resolve, reject) => {
    afriQueue[priority === 'low' ? 'low' : 'high'].push({ fn, resolve, reject });
    pumpAfri();
  });
}
async function pumpAfri() {
  if (afriQueue.running) return;
  afriQueue.running = true;
  while (afriQueue.high.length || afriQueue.low.length) {
    const job = afriQueue.high.shift() ?? afriQueue.low.shift();
    try { job.resolve(await job.fn()); } catch (e) { job.reject(e); }
  }
  afriQueue.running = false;
}
async function afriOne(text, code) {
  const modelId = await afri();
  const r = qTranslate({ modelId, text, from: 'en', to: code, modelType: 'llamacpp-completion', stream: false });
  return String(await r.text).replace(/^\s*Translation:\s*/i, '').trim();
}

/** Translate an array of short strings. Returns an array of the same length. */
export async function translateMany(texts, lang, { priority = 'high' } = {}) {
  const l = TRANSLATION_LANGS[lang];
  if (!l) throw new Error(`Unsupported language "${lang}"`);
  if (!texts.length) return [];
  if (l.engine === 'afri') {
    return Promise.all(texts.map((t) => afriJob(() => afriOne(t, l.code), priority)));
  }
  return serial(`tr_${lang}`, async () => {
    const modelId = await translator(lang);
    const r = qTranslate({ modelId, text: texts, modelType: 'nmtcpp-translation', stream: false });
    return await r.translations;
  });
}

/** Translate free text (keeps line breaks; long text is split into sentences for the LLM translator). */
export async function translate(text, lang, opts) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const l = TRANSLATION_LANGS[lang];
  if (l?.engine !== 'afri') return (await translateMany(lines, lang, opts)).join('\n');
  // AfriSLM is tuned for sentence-length input.
  const parts = lines.map((line) => line.match(/[^.!?]+[.!?]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [line]);
  const flat = parts.flat();
  const out = await translateMany(flat, lang, opts);
  let k = 0;
  return parts.map((p) => p.map(() => out[k++]).join(' ')).join('\n');
}
