// Reads course content from IO (the Profspect LMS) for offline use.
// Opens IO's SQLite mirror strictly READ-ONLY and only touches content tables
// (course, module, lesson, lesson_content). No user/learner tables, no PII.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const IO_DB_PATH = resolve(process.env.IO_DB_PATH || join(ROOT, '..', 'profspect_io_lms_development', 'instance', 'profspect.db'));

const PREFIX = { heading: '', text: '', callout: 'Note: ', example: 'Example: ', formula: 'Formula: ', summary: 'Summary: ', key_points: 'Key points: ' };

const stripHtml = (s) =>
  String(s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .trim();

export function ioAvailable() {
  return existsSync(IO_DB_PATH);
}

export function readIoCourses() {
  const db = new DatabaseSync(IO_DB_PATH, { readOnly: true });
  try {
    const courses = db.prepare('SELECT id, name, description FROM course ORDER BY id').all();
    const lessonsStmt = db.prepare(
      `SELECT l.id, l.title, l.summary, m.title AS module
         FROM lesson l JOIN module m ON m.id = l.module_id
        WHERE m.course_id = ?
        ORDER BY m.order_idx, l.order_idx, l.id`,
    );
    const blocksStmt = db.prepare('SELECT content_type, body FROM lesson_content WHERE lesson_id = ? ORDER BY order_idx, id');
    const out = [];
    for (const c of courses) {
      const lessons = lessonsStmt.all(c.id).map((l) => {
        const parts = [];
        if (l.summary) parts.push(stripHtml(l.summary));
        for (const b of blocksStmt.all(l.id)) {
          const body = stripHtml(b.body);
          if (body) parts.push((PREFIX[b.content_type] ?? '') + body);
        }
        return { id: String(l.id), title: l.title, module: l.module, text: parts.join('\n') };
      }).filter((l) => l.text.length > 20);
      if (lessons.length) out.push({ id: `io-${c.id}`, name: c.name, source: 'IO', lessons });
    }
    return out;
  } finally {
    db.close();
  }
}

/** Fallback demo content: content/<course-folder>/*.md (first "# " line = lesson title). */
export async function readSampleCourses(dir = join(ROOT, 'content')) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const folder of await readdir(dir, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    const files = (await readdir(join(dir, folder.name))).filter((f) => ['.md', '.txt'].includes(extname(f))).sort();
    const lessons = [];
    for (const f of files) {
      const raw = await readFile(join(dir, folder.name, f), 'utf8');
      const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(f, extname(f));
      lessons.push({ id: basename(f, extname(f)), title, module: 'Sample', text: raw.replace(/^#\s+.+$/m, '').trim() });
    }
    const name = folder.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    if (lessons.length) out.push({ id: `sample-${folder.name}`, name, source: 'sample', lessons });
  }
  return out;
}
