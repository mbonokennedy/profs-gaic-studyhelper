// Pull IO course content (read-only) + sample content into the offline RAG index.
// Usage: npm run sync-io        (set IO_DB_PATH to point at another IO database)
import { close } from '@qvac/sdk';
import { IO_DB_PATH, ioAvailable, readIoCourses, readSampleCourses } from '../src/io-connector.mjs';
import { loadStore, upsertCourse } from '../src/rag.mjs';

await loadStore();
const courses = [];
if (ioAvailable()) {
  console.log(`Reading IO content (read-only) from ${IO_DB_PATH}`);
  courses.push(...readIoCourses());
} else {
  console.log(`IO database not found at ${IO_DB_PATH}. Using sample content only.`);
}
courses.push(...(await readSampleCourses()));

for (const c of courses) {
  const t0 = Date.now();
  const r = await upsertCourse({
    ...c,
    onProgress: (done, total) => process.stdout.write(`\r  ${c.name.padEnd(28)} embedding ${done}/${total}`),
  });
  process.stdout.write(`\r  ✔ ${c.name.padEnd(28)} ${r.lessons} lessons, ${r.chunks} chunks (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
}
console.log(`\nIndexed ${courses.length} course(s) into data/index.json`);
await close?.().catch(() => {});
process.exit(0);
