import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('dist');
const maxMiB = Number(process.env.BLACKOUT_WEB_MAX_MIB ?? '32');
if (!Number.isFinite(maxMiB) || maxMiB <= 0) throw new Error('BLACKOUT_SAFE_INVALID_WEB_SIZE_BUDGET');
const maxBytes = Math.floor(maxMiB * 1024 * 1024);

async function directorySize(path) {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const target = resolve(path, entry.name);
    if (entry.isDirectory()) total += await directorySize(target);
    else if (entry.isFile()) total += (await stat(target)).size;
  }
  return total;
}

const total = await directorySize(root);
const totalMiB = total / 1024 / 1024;
console.log(`BLACKOUT SAFE: deployable web output ${totalMiB.toFixed(2)} MiB (budget ${maxMiB} MiB).`);
if (total > maxBytes) {
  throw new Error(`BLACKOUT_SAFE_WEB_BUNDLE_TOO_LARGE_${totalMiB.toFixed(2)}MiB_GT_${maxMiB}MiB`);
}
