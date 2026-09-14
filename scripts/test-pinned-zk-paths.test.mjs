import { readFile } from 'node:fs/promises';

const security = await readFile(new URL('../src/safe/midnight/security-hardening.ts', import.meta.url), 'utf8');

const checks = [
  ['Safe ZK path remains pinned', security.includes("'/zk-artifacts/blackout-safe'" )],
  ['Preview test-asset ZK path is explicitly pinned', security.includes("'/zk-artifacts/blackout-test-asset'" )],
  ['Pinned path resolver uses an allowlist', /PINNED_ZK_ASSET_PATHS\.has\(assetPath\)/.test(security)],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (ok) console.log(`PASS ${label}`);
  else { console.error(`FAIL ${label}`); failed += 1; }
}
if (failed) process.exit(1);
console.log(`BLACKOUT PINNED ZK PATH TESTS: ${checks.length} checks passed.`);
