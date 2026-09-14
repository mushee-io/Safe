import { readFile } from 'node:fs/promises';

const providers = await readFile(new URL('../src/safe/midnight/providers.ts', import.meta.url), 'utf8');

const checks = [
  ['Generic request failures inspect nested causes', /isGenericRequestFailure/.test(providers) && /error\.cause/.test(providers)],
  ['Provider errors remain sanitized', /sanitizeMidnightErrorMessage/.test(providers)],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (ok) console.log(`PASS ${label}`);
  else { console.error(`FAIL ${label}`); failed += 1; }
}
if (failed) process.exit(1);
console.log(`BLACKOUT PROVIDER ERROR TESTS: ${checks.length} checks passed.`);
