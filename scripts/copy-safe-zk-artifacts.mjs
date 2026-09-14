import { access, copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const fullCircuits = [
  'propose_private',
  'approve_private',
  'prove_quorum',
  'deposit_shielded',
  'execute_shielded_transfer',
  'governance_pause',
  'governance_resume',
  'governance_cancel_proposal',
  'governance_rotate_membership',
  'governance_change_policy',
  'receipt_statement',
];

// Vercel serves a lean browser bundle by default. The full Compact output is
// still generated and preserved by CI as a GitHub Actions artifact, but it is
// not copied into every web deployment. Set BLACKOUT_ZK_BUNDLE=full only for
// an explicit full-browser build.
const circuits = process.env.BLACKOUT_ZK_BUNDLE === 'full'
  ? fullCircuits
  : ['deposit_shielded'];

const source = resolve('contract/build-safe');
const destination = resolve('public/zk-artifacts/blackout-safe');
const required = circuits.flatMap((circuit) => [
  `keys/${circuit}.prover`,
  `keys/${circuit}.verifier`,
  `zkir/${circuit}.bzkir`,
]);

await Promise.all(required.map((artifact) => access(resolve(source, artifact))));
await rm(destination, { recursive: true, force: true });

for (const artifact of required) {
  const target = resolve(destination, artifact);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(source, artifact), target);
}

await Promise.all(required.map((artifact) => access(resolve(destination, artifact))));
console.log(`BLACKOUT SAFE: staged ${required.length} ZK artifacts for ${circuits.length} browser circuit(s): ${circuits.join(', ')}.`);
