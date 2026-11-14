// Tiny offline RAG store: QVAC embeddings + cosine search, persisted to data/index.json.
// (The SDK's built-in ragIngest store is labelled prototype-only; this keeps
// lesson metadata so answers can cite the lesson they came from.)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedTexts } from './ai.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = join(ROOT, 'data');
const INDEX_FILE = join(DATA_DIR, 'index.json');

// courses: { [courseId]: { id, name, source, lessons: [{ id, title, module, text }] } }
// chunks:  [{ courseId, lessonId, lessonTitle, text, vec:number[] }]
let store = { courses: {}, chunks: [] };

export async function loadStore() {
  if (existsSync(INDEX_FILE)) store = JSON.parse(await readFile(INDEX_FILE, 'utf8'));
  return store;
}

async function saveStore() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(INDEX_FILE, JSON.stringify(store));
}

export function listCourses() {
  return Object.values(store.courses)
    .map((c) => ({
      id: c.id,
      name: c.name,
      source: c.source,
      lessons: c.lessons.map((l) => ({ id: l.id, title: l.title, module: l.module })),
      chunks: store.chunks.filter((k) => k.courseId === c.id).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getLesson(courseId, lessonId) {
  return store.courses[courseId]?.lessons.find((l) => String(l.id) === String(lessonId));
}

export function getCourse(courseId) {
  return store.courses[courseId];
}

export function chunkText(text, size = 550, overlap = 80) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const out = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(clean.length, i + size);
    if (end < clean.length) {
      const dot = clean.lastIndexOf('. ', end);
      if (dot > i + size * 0.5) end = dot + 1;
    }
    out.push(clean.slice(i, end).trim());
    if (end >= clean.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out;
}

/** Replace a course (or add lessons to it) and embed its chunks. */
export async function upsertCourse({ id, name, source = 'manual', lessons, replace = true, onProgress }) {
  id = String(id);
  const existing = store.courses[id];
  const merged = replace || !existing ? lessons : [...existing.lessons.filter((l) => !lessons.some((n) => String(n.id) === String(l.id))), ...lessons];
  store.courses[id] = { id, name: name ?? existing?.name ?? id, source, lessons: merged };

  const touched = new Set(lessons.map((l) => String(l.id)));
  store.chunks = store.chunks.filter((k) => k.courseId !== id || (!replace && !touched.has(String(k.lessonId))));

  const pending = [];
  for (const l of lessons) {
    for (const piece of chunkText(l.text)) {
      pending.push({ courseId: id, lessonId: String(l.id), lessonTitle: l.title, text: piece });
    }
  }
  // Prefix with the lesson title so short chunks still carry their topic.
  const BATCH = 32;
  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH);
    const vecs = await embedTexts(slice.map((p) => `${p.lessonTitle}: ${p.text}`));
    slice.forEach((p, j) => (p.vec = vecs[j].map((v) => +v.toFixed(5))));
    store.chunks.push(...slice);
    onProgress?.(Math.min(i + BATCH, pending.length), pending.length);
  }
  await saveStore();
  return { courseId: id, lessons: lessons.length, chunks: pending.length };
}

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

export async function search(query, { courseId, lessonId, topK = 4, minScore = 0.72 } = {}) {
  let pool = store.chunks;
  if (courseId) pool = pool.filter((c) => c.courseId === String(courseId));
  if (lessonId) pool = pool.filter((c) => c.lessonId === String(lessonId));
  if (!pool.length) return [];
  const [q] = await embedTexts([query]);
  return pool
    .map((c) => ({ courseId: c.courseId, lessonId: c.lessonId, lessonTitle: c.lessonTitle, text: c.text, score: cosine(q, c.vec) }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
