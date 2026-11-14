// One-time model download. Run while ONLINE: `npm run setup`.
// Afterwards IO Offline runs with no internet at all.
import { downloadAsset, close } from '@qvac/sdk';
import { allDownloadNames, modelSrc } from '../src/models.mjs';

const names = process.argv.slice(2).length ? process.argv.slice(2) : allDownloadNames();
const mb = (n) => (n / 1e6).toFixed(1);
let failed = 0;

console.log(`IO Offline: downloading ${names.length} models to the QVAC cache (~/.qvac/models)\n`);
for (const name of names) {
  const started = Date.now();
  let last = -1;
  try {
    await downloadAsset({
      assetSrc: modelSrc(name),
      onProgress: (p) => {
        const pct = Math.floor(p.percentage ?? 0);
        if (pct === last) return;
        last = pct;
        const line = `  ${name.padEnd(28)} ${String(pct).padStart(3)}%  ${mb(p.downloaded ?? 0)}/${mb(p.total ?? 0)} MB`;
        process.stdout.write(process.stdout.isTTY ? `\r${line}` : (pct % 25 === 0 ? `${line}\n` : ''));
      },
    });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    process.stdout.write(`${process.stdout.isTTY ? '\r' : ''}  ✔ ${name.padEnd(28)} ready (${secs}s)                    \n`);
  } catch (err) {
    failed++;
    process.stdout.write(`\n  ✖ ${name}: ${err?.message ?? err}\n`);
  }
}

console.log(failed ? `\n${failed} model(s) failed. Re-run \`npm run setup\` (downloads resume).` : '\nAll models cached. You can now go offline and run `npm start`.');
await close?.().catch(() => {});
process.exit(failed ? 1 : 0);
