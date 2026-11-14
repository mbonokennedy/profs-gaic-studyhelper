// Page-level translation with a persistent cache (data/i18n/<lang>.json).
// The UI's own strings are translated in the background once, so switching the whole
// page to isiZulu or Afrikaans is instant in a demo; lesson and chat text is translated
// on demand and cached too.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateMany, translate } from './ai.mjs';
import { TRANSLATION_LANGS } from './models.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data', 'i18n');
const caches = new Map(); // lang -> Map(text -> translation)
const dirty = new Set();

async function cacheFor(lang) {
  if (!caches.has(lang)) {
    const f = join(DIR, `${lang}.json`);
    caches.set(lang, new Map(existsSync(f) ? Object.entries(JSON.parse(await readFile(f, 'utf8'))) : []));
  }
  return caches.get(lang);
}
let flushTimer;
function scheduleFlush(lang) {
  dirty.add(lang);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    await mkdir(DIR, { recursive: true });
    for (const l of dirty) await writeFile(join(DIR, `${l}.json`), JSON.stringify(Object.fromEntries(caches.get(l)), null, 0));
    dirty.clear();
  }, 1500);
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const translatable = (s) => /\p{L}{2,}/u.test(s) && s.length <= 600;

/** Translate many strings, using the cache. Returns { translations, fromCache }. */
export async function translateTexts(texts, lang, { priority = 'high' } = {}) {
  if (!TRANSLATION_LANGS[lang]) throw Object.assign(new Error(`Unsupported language "${lang}"`), { status: 400 });
  const cache = await cacheFor(lang);
  const keys = texts.map(norm);
  const todo = [...new Set(keys.filter((k) => translatable(k) && !cache.has(k)))];
  const fromCache = keys.length - todo.length;
  if (todo.length) {
    // Long strings (e.g. a whole tutor answer) go sentence-by-sentence to the LLM translator.
    const isAfri = TRANSLATION_LANGS[lang].engine === 'afri';
    const short = isAfri ? todo.filter((k) => k.length <= 180) : todo;
    const long = isAfri ? todo.filter((k) => k.length > 180) : [];
    const out = await translateMany(short, lang, { priority });
    short.forEach((k, i) => out[i] && cache.set(k, String(out[i]).trim()));
    for (const k of long) cache.set(k, (await translate(k, lang, { priority })).trim());
    scheduleFlush(lang);
  }
  return { translations: keys.map((k) => (translatable(k) ? cache.get(k) ?? k : k)), fromCache };
}

/** Visible text of the app shell, pulled from index.html (no scripts/styles/svg). */
export function uiStrings() {
  const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '');
  const texts = [...html.matchAll(/>([^<>]+)</g)].map((m) => norm(m[1].replace(/&[a-z]+;/g, ' ')));
  const attrs = [...html.matchAll(/(?:placeholder|title)="([^"]+)"/g)].map((m) => norm(m[1]));
  return [...new Set([...texts, ...attrs, 'Whole course', 'Ask a question…'])].filter(translatable);
}

// Strings the front-end sets at runtime (view titles, starter prompts, status lines).
const RUNTIME_STRINGS = [
  'Dashboard', 'Your offline study space.', 'AI Tutor', 'Ask about your lessons. Answers are generated on this device.',
  'Practice Quiz', 'Test yourself on any lesson, marked instantly.', 'Summarise Lesson', 'Revision notes in seconds.',
  'Tap an answer', 'What next?', 'Another question', 'Explain it step by step', 'Why was my answer wrong?',
  'I’m not sure, give me a hint', 'Read aloud', 'Listen', 'Translate', 'Generating…', 'Summarising…', 'Signed in through IO',
];

/** Background: translate the UI strings into every South African language, low priority. */
export async function warmUi(log = () => {}, extra = []) {
  const strings = [...new Set([...uiStrings(), ...RUNTIME_STRINGS, ...extra.map(norm)])].filter(translatable);
  for (const [lang, l] of Object.entries(TRANSLATION_LANGS)) {
    if (!l.sa) continue;
    const cache = await cacheFor(lang);
    const missing = strings.filter((s) => !cache.has(s));
    if (!missing.length) continue;
    const t0 = Date.now();
    // Small batches so progress is saved to disk as it goes.
    for (let i = 0; i < missing.length; i += 10) {
      await translateTexts(missing.slice(i, i + 10), lang, { priority: 'low' }).catch((e) => log(`i18n ${lang}: ${e.message}`));
    }
    log(`i18n: ${l.label} UI ready (${missing.length} strings, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}
