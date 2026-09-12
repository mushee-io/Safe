import { buildMembershipTree, deriveMemberCommitment, domainHash, ZERO_HEX32 } from './crypto.ts';
import { computeGovernanceOperationCommitment } from './governance.ts';
import type { Hex32, PrivateMemberMaterial, PrivateProposalPayload, TreasuryPolicy } from './model.ts';
import { BlackoutSafeReferenceEngine } from './reference-engine.ts';

let pass = 0;
let fail = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    pass += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    fail += 1;
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}

async function setup() {
  const memberSecret = await domainHash('blackout:safe:proposal-privacy:secret:v1', 'alice');
  const memberCommitment = await deriveMemberCommitment(memberSecret);
  const tree = await buildMembershipTree([memberCommitment], 4);
  const safeId = await domainHash('blackout:safe:proposal-privacy:safe:v1', 'safe');
  const policy: TreasuryPolicy = {
    mode: 'STANDARD',
    threshold: 1,
    membershipVersion: 1n,
    policyVersion: 1n,
    maxTransferAmount: 10_000n,
  };
  const engine = await BlackoutSafeReferenceEngine.create({ safeId, membershipRoot: tree.root, policy });
  const member: PrivateMemberMaterial = {
    memberSecret,
    memberCommitment,
    membershipProof: tree.proofs[0],
    membershipVersion: 1n,
  };
  return { safeId, engine, member };
}

function serialized(value: unknown): string {
  return JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
}

await test('M15 public governance proposal state does not reveal proposal category', async () => {
  const f = await setup();
  const operation = { action: 'PAUSE' } as const;
  const payload: PrivateProposalPayload = {
    safeId: f.safeId,
    actionType: 'GOVERNANCE',
    asset: ZERO_HEX32,
    recipient: ZERO_HEX32,
    amount: 0n,
    calldataOrAction: await computeGovernanceOperationCommitment(operation),
    memoHash: await domainHash('blackout:safe:proposal-privacy:memo:v1', 'pause'),
    createdAt: 1_800_000_000n,
    expiresAt: 1_800_003_600n,
    nonce: await domainHash('blackout:safe:proposal-privacy:nonce:v1', 'pause'),
    salt: await domainHash('blackout:safe:proposal-privacy:salt:v1', 'pause'),
  };
  const receipt = await f.engine.propose(payload, f.member);
  const publicState = f.engine.proposals.get(receipt.proposalCommitment);
  assert(publicState !== undefined, 'proposal must exist');
  const receiptJson = serialized(receipt);
  const stateJson = serialized(publicState);
  assert(!receiptJson.includes('GOVERNANCE') && !receiptJson.includes('TREASURY'), 'public receipt must not reveal proposal category');
  assert(!stateJson.includes('GOVERNANCE') && !stateJson.includes('TREASURY'), 'public proposal state must not reveal proposal category');
  assert(!Object.prototype.hasOwnProperty.call(receipt, 'kind'), 'public receipt must not expose kind field');
  assert(!Object.prototype.hasOwnProperty.call(publicState, 'kind'), 'public state must not expose kind field');
});

await test('M15 treasury proposal state also exposes only commitment-bound public metadata', async () => {
  const f = await setup();
  const payload: PrivateProposalPayload = {
    safeId: f.safeId,
    actionType: 'TRANSFER',
    asset: await domainHash('blackout:safe:proposal-privacy:asset:v1', 'asset'),
    recipient: await domainHash('blackout:safe:proposal-privacy:recipient:v1', 'recipient'),
    amount: 25n,
    calldataOrAction: await domainHash('blackout:safe:proposal-privacy:action:v1', 'transfer'),
    memoHash: await domainHash('blackout:safe:proposal-privacy:memo:v1', 'transfer'),
    createdAt: 1_800_000_000n,
    expiresAt: 1_800_003_600n,
    nonce: await domainHash('blackout:safe:proposal-privacy:nonce:v1', 'transfer'),
    salt: await domainHash('blackout:safe:proposal-privacy:salt:v1', 'transfer'),
  };
  const receipt = await f.engine.propose(payload, f.member);
  const publicState = f.engine.proposals.get(receipt.proposalCommitment);
  assert(publicState !== undefined, 'proposal must exist');
  assert(!serialized(publicState).includes(payload.recipient), 'public state must not reveal recipient');
  assert(!serialized(publicState).includes('25'), 'public state must not reveal transfer amount');
  assert(!Object.prototype.hasOwnProperty.call(publicState, 'kind'), 'public state must not expose proposal category');
});

console.log(`\nBLACKOUT SAFE PROPOSAL PRIVACY TESTS: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
