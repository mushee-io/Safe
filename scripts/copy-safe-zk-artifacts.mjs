import { access, cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const circuits = [
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
  'receipt_quorum_authorized',
  'receipt_executed_exactly_once',
  'receipt_disclose_amount',
  'receipt_disclose_recipient',
  'receipt_proposal_cancelled',
];

const source = resolve('contract/build-safe');
const destination = resolve('public/zk-artifacts/blackout-safe');
const required = circuits.flatMap((circuit) => [
  `keys/${circuit}.prover`,
  `keys/${circuit}.verifier`,
  `zkir/${circuit}.bzkir`,
]);

await Promise.all(required.map((artifact) => access(resolve(source, artifact))));
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await Promise.all([
  cp(resolve(source, 'keys'), resolve(destination, 'keys'), { recursive: true }),
  cp(resolve(source, 'zkir'), resolve(destination, 'zkir'), { recursive: true }),
]);
await Promise.all(required.map((artifact) => access(resolve(destination, artifact))));
console.log(`BLACKOUT SAFE: staged ${required.length} ZK artifacts for ${circuits.length} circuits.`);
