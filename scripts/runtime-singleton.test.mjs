import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');

const requiredSingletons = [
  '@midnight-ntwrk/compact-runtime',
  '@midnight-ntwrk/midnight-js-protocol',
  '@midnight-ntwrk/onchain-runtime-v3',
];

const checks = [
  [
    'Compact runtime is pinned across the npm dependency graph',
    packageJson.overrides?.['@midnight-ntwrk/compact-runtime'] === '0.16.0',
  ],
  ...requiredSingletons.map((name) => [
    `Vite dedupes ${name}`,
    viteConfig.includes(`'${name}'`),
  ]),
  [
    'Midnight singleton runtime dependencies are excluded from dependency prebundling',
    /optimizeDeps:[\s\S]*exclude:[\s\S]*MIDNIGHT_SINGLETON_MODULES/.test(viteConfig),
  ],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (ok) console.log(`PASS ${label}`);
  else {
    console.error(`FAIL ${label}`);
    failed += 1;
  }
}

if (failed) process.exit(1);
console.log(`BLACKOUT RUNTIME SINGLETON TESTS: ${checks.length} checks passed.`);
