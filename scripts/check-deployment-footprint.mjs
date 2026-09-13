import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const CONTRACT_INFO = 'contract/build-safe/compiler/contract-info.json';
const KEYS_DIR = 'contract/build-safe/keys';
const MAX_EXPORTED_CIRCUITS = 11;
const MAX_VERIFIER_BYTES = 25_000;

const required = [
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

const legacyReceiptCircuits = [
  'receipt_quorum_authorized',
  'receipt_executed_exactly_once',
  'receipt_disclose_amount',
  'receipt_disclose_recipient',
  'receipt_proposal_cancelled',
];

const info = JSON.parse(await readFile(CONTRACT_INFO, 'utf8'));
const circuits = info.circuits.map((c) => c.name);
const actual = new Set(circuits);

if (circuits.length !== MAX_EXPORTED_CIRCUITS) {
  throw new Error(`BLACKOUT_SAFE_DEPLOYMENT_CIRCUIT_BUDGET_EXCEEDED: expected ${MAX_EXPORTED_CIRCUITS}, got ${circuits.length}`);
}
for (const name of required) {
  if (!actual.has(name)) throw new Error(`BLACKOUT_SAFE_REQUIRED_CIRCUIT_MISSING: ${name}`);
}
for (const name of legacyReceiptCircuits) {
  if (actual.has(name)) throw new Error(`BLACKOUT_SAFE_LEGACY_RECEIPT_CIRCUIT_PRESENT: ${name}`);
}

const keyFiles = await readdir(KEYS_DIR);
const verifierFiles = keyFiles.filter((name) => name.endsWith('.verifier'));
if (verifierFiles.length !== MAX_EXPORTED_CIRCUITS) {
  throw new Error(`BLACKOUT_SAFE_VERIFIER_COUNT_MISMATCH: expected ${MAX_EXPORTED_CIRCUITS}, got ${verifierFiles.length}`);
}

let verifierBytes = 0;
for (const file of verifierFiles) verifierBytes += (await stat(join(KEYS_DIR, file))).size;
if (verifierBytes > MAX_VERIFIER_BYTES) {
  throw new Error(`BLACKOUT_SAFE_VERIFIER_BUDGET_EXCEEDED: ${verifierBytes} > ${MAX_VERIFIER_BYTES}`);
}

for (const legacy of legacyReceiptCircuits) {
  if (keyFiles.includes(`${legacy}.verifier`) || keyFiles.includes(`${legacy}.prover`)) {
    throw new Error(`BLACKOUT_SAFE_LEGACY_RECEIPT_KEY_PRESENT: ${legacy}`);
  }
}

console.log(`BLACKOUT SAFE DEPLOYMENT FOOTPRINT: ${circuits.length} circuits, ${verifierBytes} verifier bytes (budget ${MAX_VERIFIER_BYTES})`);
