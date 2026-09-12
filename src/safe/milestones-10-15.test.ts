import {
  buildMembershipTree,
  domainHash,
  deriveMemberCommitment,
  ZERO_HEX32,
} from './crypto.ts';
import { computeGovernanceOperationCommitment } from './governance.ts';
import type {
  BlackoutReceiptEnvelope,
  GovernanceOperation,
  Hex32,
  PrivateMemberMaterial,
  PrivateProposalPayload,
  TreasuryPolicy,
} from './model.ts';
import {
  buildExecutionReferenceReceipt,
  buildGovernanceReferenceReceipt,
  buildQuorumReferenceReceipt,
  toBlackoutVerifyPayload,
  UnavailableMidnightReceiptVerifier,
  verifyBlackoutReceipt,
  type MidnightReceiptVerifierAdapter,
} from './receipts.ts';
import { BlackoutSafeReferenceEngine, SafeProtocolError } from './reference-engine.ts';
import { ReferenceShieldedTreasury, type ShieldedTreasuryAdapter } from './treasury.ts';

let pass = 0;
let fail = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectCode(code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof SafeProtocolError, `expected SafeProtocolError, got ${String(error)}`);
    assert(error.code === code, `expected ${code}, got ${error.code}`);
    return;
  }
  throw new Error(`expected ${code}, but call succeeded`);
}

async function secret(label: string): Promise<Hex32> {
  return domainHash('blackout:safe:m10-15:secret:v1', label);
}

async function fixture() {
  const labels = ['alice', 'bob', 'carol', 'dave', 'mallory'];
  const entries = await Promise.all(labels.map(async (label) => {
    const memberSecret = await secret(label);
    return { label, secret: memberSecret, commitment: await deriveMemberCommitment(memberSecret) };
  }));
  const [alice, bob, carol, dave, mallory] = entries;
  const tree = await buildMembershipTree([alice.commitment, bob.commitment, carol.commitment], 4);
  const safeId = await domainHash('blackout:safe:m10-15:safe:v1', 'safe-a');
  const policy: TreasuryPolicy = {
    mode: 'STANDARD',
    threshold: 2,
    membershipVersion: 1n,
    policyVersion: 1n,
    maxTransferAmount: 10_000n,
    maxProposalLifetimeSeconds: 86_400n,
  };
  const engine = await BlackoutSafeReferenceEngine.create({ safeId, membershipRoot: tree.root, policy });
  const member = (entry: typeof alice, proofIndex: number, version = 1n, proofTree = tree): PrivateMemberMaterial => ({
    memberSecret: entry.secret,
    memberCommitment: entry.commitment,
    membershipProof: proofTree.proofs[proofIndex],
    membershipVersion: version,
  });
  const transfer: PrivateProposalPayload = {
    safeId,
    actionType: 'TRANSFER',
    asset: await domainHash('asset', 'tNIGHT'),
    recipient: await domainHash('recipient', 'vendor'),
    amount: 500n,
    calldataOrAction: await domainHash('action', 'transfer'),
    memoHash: await domainHash('memo', 'm10-15-transfer'),
    createdAt: 1_800_000_000n,
    expiresAt: 1_800_043_200n,
    nonce: await domainHash('nonce', 'transfer-1'),
    salt: await domainHash('salt', 'transfer-1'),
  };
  return { alice, bob, carol, dave, mallory, tree, safeId, policy, engine, member, transfer };
}

async function governancePayload(
  safeId: Hex32,
  operation: GovernanceOperation,
  label: string,
  createdAt = 1_800_000_000n,
): Promise<PrivateProposalPayload> {
  return {
    safeId,
    actionType: 'GOVERNANCE',
    asset: ZERO_HEX32,
    recipient: ZERO_HEX32,
    amount: 0n,
    calldataOrAction: await computeGovernanceOperationCommitment(operation),
    memoHash: await domainHash('blackout:safe:governance:memo:v1', label),
    createdAt,
    expiresAt: createdAt + 43_200n,
    nonce: await domainHash('blackout:safe:governance:nonce:v1', label),
    salt: await domainHash('blackout:safe:governance:salt:v1', label),
  };
}

async function prepareGovernance(
  f: Awaited<ReturnType<typeof fixture>>,
  operation: GovernanceOperation,
  label: string,
) {
  const payload = await governancePayload(f.safeId, operation, label);
  const proposal = await f.engine.propose(payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  return { payload, proposal };
}

async function prepareTransfer(f: Awaited<ReturnType<typeof fixture>>) {
  const proposal = await f.engine.propose(f.transfer, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  return proposal;
}

// ---------------------------------------------------------------------------
// M10 hardening — shielded treasury boundary
// ---------------------------------------------------------------------------

await test('M10 reference treasury advertises non-LIVE capabilities honestly', async () => {
  const f = await fixture();
  const treasury = new ReferenceShieldedTreasury([{ tokenType: f.transfer.asset, balance: 1_000n }]);
  const caps = await treasury.getCapabilities();
  assert(caps.mode === 'REFERENCE', 'reference harness must never claim LIVE');
  assert(caps.recipientDiscovery === 'EXECUTOR_ASSISTED', 'recipient discovery limitation must be explicit');
  assert(!caps.returnsNetworkTransactionId, 'reference harness must not invent a network tx id');
});

await test('M10 LIVE adapter without tx-id capability is rejected before transfer call', async () => {
  const f = await fixture();
  const proposal = await prepareTransfer(f);
  let transfers = 0;
  const treasury: ShieldedTreasuryAdapter = {
    async getCapabilities() {
      return { mode: 'LIVE', supportsShieldedCustody: true, supportsShieldedSpend: true, recipientDiscovery: 'EXECUTOR_ASSISTED', returnsNetworkTransactionId: false };
    },
    async getSpendableBalance() { return 1_000n; },
    async executeShieldedTransfer() {
      transfers += 1;
      throw new Error('must not be called');
    },
  };
  await expectCode('LIVE_TREASURY_TX_ID_UNSUPPORTED', () => f.engine.execute({
    proposalCommitment: proposal.proposalCommitment,
    payload: f.transfer,
    nowSeconds: f.transfer.createdAt + 10n,
    treasury,
  }));
  assert(transfers === 0, 'unsafe LIVE adapter must fail before attempting a transfer');
});

await test('M10 ambiguous LIVE transfer outcome locks proposal against retry', async () => {
  const f = await fixture();
  const proposal = await prepareTransfer(f);
  const treasury: ShieldedTreasuryAdapter = {
    async getCapabilities() {
      return { mode: 'LIVE', supportsShieldedCustody: true, supportsShieldedSpend: true, recipientDiscovery: 'EXECUTOR_ASSISTED', returnsNetworkTransactionId: true };
    },
    async getSpendableBalance() { return 1_000n; },
    async executeShieldedTransfer() {
      return {
        transferId: await domainHash('test-only-live-shape', 'ambiguous'),
        kind: 'SHIELDED',
        mode: 'LIVE',
        networkTransactionId: null,
        recipientDiscovery: 'EXECUTOR_ASSISTED',
      };
    },
  };
  await expectCode('LIVE_TRANSFER_OUTCOME_UNCERTAIN', () => f.engine.execute({
    proposalCommitment: proposal.proposalCommitment,
    payload: f.transfer,
    nowSeconds: f.transfer.createdAt + 10n,
    treasury,
  }));
  assert(f.engine.proposals.get(proposal.proposalCommitment)?.status === 'EXECUTION_UNCERTAIN', 'ambiguous LIVE transfer must become non-retryable');
});

// ---------------------------------------------------------------------------
// M11 + M12 — Blackout Receipt + Blackout Verify interoperability
// ---------------------------------------------------------------------------

await test('M11 quorum receipt reveals no signer identities or private transfer fields by default', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.transfer, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const quorum = await f.engine.proveQuorum(proposal.proposalCommitment);
  const receipt = await buildQuorumReferenceReceipt(quorum);
  const serialized = JSON.stringify(receipt, (_, v) => typeof v === 'bigint' ? v.toString() : v);
  assert(!serialized.includes(f.alice.commitment) && !serialized.includes(f.bob.commitment), 'receipt must not reveal approver commitments');
  assert(!serialized.includes(f.transfer.recipient), 'receipt must not reveal recipient by default');
  assert(!serialized.includes('500'), 'receipt must not reveal amount by default');
});

await test('M11 selective disclosure includes amount without forcing recipient disclosure', async () => {
  const f = await fixture();
  const proposal = await prepareTransfer(f);
  const treasury = new ReferenceShieldedTreasury([{ tokenType: f.transfer.asset, balance: 1_000n }]);
  const execution = await f.engine.execute({
    proposalCommitment: proposal.proposalCommitment,
    payload: f.transfer,
    nowSeconds: f.transfer.createdAt + 10n,
    treasury,
  });
  const receipt = await buildExecutionReferenceReceipt(execution, { amount: f.transfer.amount });
  assert(receipt.disclosures.amount === 500n, 'selected amount should be disclosed');
  assert(receipt.disclosures.recipient === undefined, 'recipient must remain hidden unless selected');
});

await test('M11 receipt tampering is detected before any proof verification', async () => {
  const f = await fixture();
  const proposal = await prepareTransfer(f);
  const treasury = new ReferenceShieldedTreasury([{ tokenType: f.transfer.asset, balance: 1_000n }]);
  const execution = await f.engine.execute({ proposalCommitment: proposal.proposalCommitment, payload: f.transfer, nowSeconds: f.transfer.createdAt + 10n, treasury });
  const receipt = await buildExecutionReferenceReceipt(execution);
  const tampered: BlackoutReceiptEnvelope = {
    ...receipt,
    publicInputs: { ...receipt.publicInputs, executionNullifier: await domainHash('tamper', 'execution-nullifier') },
  };
  const result = await verifyBlackoutReceipt(tampered, new UnavailableMidnightReceiptVerifier(), 'REFERENCE');
  assert(!result.valid && result.code === 'RECEIPT_INTEGRITY_MISMATCH', 'tampered receipt must fail integrity');
});

await test('M12 Blackout Verify LIVE rejects reference-only receipts', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.transfer, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const receipt = await buildQuorumReferenceReceipt(await f.engine.proveQuorum(proposal.proposalCommitment));
  const result = await verifyBlackoutReceipt(receipt, new UnavailableMidnightReceiptVerifier(), 'LIVE');
  assert(!result.valid && result.code === 'REFERENCE_PROOF_NOT_ACCEPTED', 'LIVE Verify must never accept reference integrity as a ZK proof');
});

await test('M12 reference verification is explicitly non-cryptographic', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.transfer, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const receipt = await buildQuorumReferenceReceipt(await f.engine.proveQuorum(proposal.proposalCommitment));
  const result = await verifyBlackoutReceipt(receipt, new UnavailableMidnightReceiptVerifier(), 'REFERENCE');
  assert(result.valid && !result.cryptographicallyVerified && result.code === 'REFERENCE_INTEGRITY_ONLY', 'reference mode must be labeled integrity-only');
});

await test('M12 MIDNIGHT receipt without proof fails closed', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.transfer, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const reference = await buildQuorumReferenceReceipt(await f.engine.proveQuorum(proposal.proposalCommitment));
  const midnight: BlackoutReceiptEnvelope = { ...reference, proofSystem: 'MIDNIGHT', proof: null };
  const result = await verifyBlackoutReceipt(midnight, new UnavailableMidnightReceiptVerifier(), 'LIVE');
  assert(!result.valid && result.code === 'MISSING_MIDNIGHT_PROOF', 'missing proof must fail closed');
});

await test('M12 unavailable real verifier returns exact blocker rather than local success', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.transfer, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const reference = await buildQuorumReferenceReceipt(await f.engine.proveQuorum(proposal.proposalCommitment));
  const midnight: BlackoutReceiptEnvelope = { ...reference, proofSystem: 'MIDNIGHT', proof: 'opaque-test-proof-bytes' };
  const result = await verifyBlackoutReceipt(midnight, new UnavailableMidnightReceiptVerifier(), 'LIVE');
  assert(!result.valid && result.code === 'MIDNIGHT_VERIFIER_UNAVAILABLE', 'unavailable proof verifier must fail closed');
});

await test('M12 verifier adapter success path is cryptographically labeled only by adapter result', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.transfer, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const reference = await buildQuorumReferenceReceipt(await f.engine.proveQuorum(proposal.proposalCommitment));
  const midnight: BlackoutReceiptEnvelope = { ...reference, proofSystem: 'MIDNIGHT', proof: 'test-only-adapter-payload' };
  const testOnlyVerifier: MidnightReceiptVerifierAdapter = { async verifyReceipt() { return true; } };
  const result = await verifyBlackoutReceipt(midnight, testOnlyVerifier, 'LIVE');
  assert(result.valid && result.cryptographicallyVerified && result.code === 'MIDNIGHT_PROOF_VERIFIED', 'adapter-verified proof should be labeled verified');
});

await test('M12 Blackout Verify payload is versioned and protocol-scoped', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.transfer, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const receipt = await buildQuorumReferenceReceipt(await f.engine.proveQuorum(proposal.proposalCommitment));
  const payload = toBlackoutVerifyPayload(receipt);
  assert(payload.protocol === 'blackout-safe' && payload.version === 1 && payload.receipt === receipt, 'Verify payload contract should be stable');
});

// ---------------------------------------------------------------------------
// M13 + M14 — governed rotation, policy change, pause/resume, cancellation
// ---------------------------------------------------------------------------

await test('M13 governance execution fails below quorum', async () => {
  const f = await fixture();
  const operation: GovernanceOperation = { action: 'PAUSE' };
  const payload = await governancePayload(f.safeId, operation, 'pause-below-quorum');
  const proposal = await f.engine.propose(payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await expectCode('QUORUM_NOT_REACHED', () => f.engine.executeGovernance({
    proposalCommitment: proposal.proposalCommitment,
    payload,
    operation,
    nowSeconds: payload.createdAt + 10n,
  }));
});

await test('M13 governance operation substitution fails commitment check', async () => {
  const f = await fixture();
  const committed: GovernanceOperation = { action: 'PAUSE' };
  const { payload, proposal } = await prepareGovernance(f, committed, 'pause-substitution');
  await expectCode('GOVERNANCE_OPERATION_MISMATCH', () => f.engine.executeGovernance({
    proposalCommitment: proposal.proposalCommitment,
    payload,
    operation: { action: 'RESUME' },
    nowSeconds: payload.createdAt + 10n,
  }));
});

await test('M14 PAUSE requires quorum and then blocks new treasury proposals', async () => {
  const f = await fixture();
  const operation: GovernanceOperation = { action: 'PAUSE' };
  const { payload, proposal } = await prepareGovernance(f, operation, 'pause-safe');
  const receipt = await f.engine.executeGovernance({ proposalCommitment: proposal.proposalCommitment, payload, operation, nowSeconds: payload.createdAt + 10n });
  assert(receipt.safeStatus === 'PAUSED' && f.engine.publicState.status === 'PAUSED', 'Safe should be paused by governed execution');
  const pausedNonce = await domainHash('nonce', 'paused-new-transfer');
  await expectCode('SAFE_PAUSED', () => f.engine.propose({ ...f.transfer, nonce: pausedNonce }, f.member(f.alice, 0)));
});

await test('M14 paused Safe blocks approval of pre-existing treasury proposal', async () => {
  const f = await fixture();
  const treasuryProposal = await f.engine.propose(f.transfer, f.member(f.alice, 0));
  const pause: GovernanceOperation = { action: 'PAUSE' };
  const prepared = await prepareGovernance(f, pause, 'pause-with-pending-transfer');
  await f.engine.executeGovernance({ proposalCommitment: prepared.proposal.proposalCommitment, payload: prepared.payload, operation: pause, nowSeconds: prepared.payload.createdAt + 10n });
  await expectCode('SAFE_PAUSED', () => f.engine.approve(treasuryProposal.proposalCommitment, f.member(f.bob, 1)));
});

await test('M14 recovery governance remains available while paused and can RESUME', async () => {
  const f = await fixture();
  const pause: GovernanceOperation = { action: 'PAUSE' };
  const p = await prepareGovernance(f, pause, 'pause-before-resume');
  await f.engine.executeGovernance({ proposalCommitment: p.proposal.proposalCommitment, payload: p.payload, operation: pause, nowSeconds: p.payload.createdAt + 10n });

  const resume: GovernanceOperation = { action: 'RESUME' };
  const r = await prepareGovernance(f, resume, 'resume-while-paused');
  const receipt = await f.engine.executeGovernance({ proposalCommitment: r.proposal.proposalCommitment, payload: r.payload, operation: resume, nowSeconds: r.payload.createdAt + 10n });
  assert(receipt.safeStatus === 'ACTIVE' && f.engine.publicState.status === 'ACTIVE', 'governed resume should restore treasury actions');
});

await test('M13 governed membership rotation increments epoch and changes policy commitment', async () => {
  const f = await fixture();
  const newTree = await buildMembershipTree([f.bob.commitment, f.carol.commitment, f.dave.commitment], 4);
  const before = f.engine.publicState;
  const operation: GovernanceOperation = { action: 'ROTATE_MEMBERSHIP', newMembershipRoot: newTree.root };
  const prepared = await prepareGovernance(f, operation, 'rotate-members');
  const receipt = await f.engine.executeGovernance({ proposalCommitment: prepared.proposal.proposalCommitment, payload: prepared.payload, operation, nowSeconds: prepared.payload.createdAt + 10n });
  assert(receipt.membershipVersion === 2n, 'membership version must increment');
  assert(receipt.membershipRoot === newTree.root, 'new membership root must become active');
  assert(receipt.policyCommitment !== before.policyCommitment, 'policy commitment must rebind to new membership epoch');
});

await test('M13 old member material fails after governed rotation', async () => {
  const f = await fixture();
  const newTree = await buildMembershipTree([f.bob.commitment, f.carol.commitment, f.dave.commitment], 4);
  const operation: GovernanceOperation = { action: 'ROTATE_MEMBERSHIP', newMembershipRoot: newTree.root };
  const prepared = await prepareGovernance(f, operation, 'rotate-removes-alice');
  await f.engine.executeGovernance({ proposalCommitment: prepared.proposal.proposalCommitment, payload: prepared.payload, operation, nowSeconds: prepared.payload.createdAt + 10n });
  const rotatedNonce = await domainHash('nonce', 'after-rotation');
  await expectCode('STALE_MEMBERSHIP', () => f.engine.propose({ ...f.transfer, nonce: rotatedNonce }, f.member(f.alice, 0)));
});

await test('M13 pending old-epoch proposal becomes non-executable after membership rotation', async () => {
  const f = await fixture();
  const old = await f.engine.propose(f.transfer, f.member(f.alice, 0));
  const newTree = await buildMembershipTree([f.bob.commitment, f.carol.commitment, f.dave.commitment], 4);
  const operation: GovernanceOperation = { action: 'ROTATE_MEMBERSHIP', newMembershipRoot: newTree.root };
  const prepared = await prepareGovernance(f, operation, 'rotate-invalidates-pending');
  await f.engine.executeGovernance({ proposalCommitment: prepared.proposal.proposalCommitment, payload: prepared.payload, operation, nowSeconds: prepared.payload.createdAt + 10n });
  const bobV2 = f.member(f.bob, 0, 2n, newTree);
  await expectCode('PROPOSAL_STALE_MEMBERSHIP', () => f.engine.approve(old.proposalCommitment, bobV2));
});

await test('M13 retained member with new Merkle path can act after rotation', async () => {
  const f = await fixture();
  const newTree = await buildMembershipTree([f.bob.commitment, f.carol.commitment, f.dave.commitment], 4);
  const operation: GovernanceOperation = { action: 'ROTATE_MEMBERSHIP', newMembershipRoot: newTree.root };
  const prepared = await prepareGovernance(f, operation, 'rotate-retains-bob');
  await f.engine.executeGovernance({ proposalCommitment: prepared.proposal.proposalCommitment, payload: prepared.payload, operation, nowSeconds: prepared.payload.createdAt + 10n });
  const bobV2 = f.member(f.bob, 0, 2n, newTree);
  const proposal = await f.engine.propose({ ...f.transfer, nonce: await domainHash('nonce', 'bob-v2'), salt: await domainHash('salt', 'bob-v2') }, bobV2);
  assert(proposal.membershipVersion === 2n, 'new proposal must bind the new membership epoch');
});

await test('M13 policy change must increment exactly once and bind current membership', async () => {
  const f = await fixture();
  const newPolicy: TreasuryPolicy = {
    mode: 'PRIVATE_POLICY',
    threshold: 3,
    membershipVersion: 1n,
    policyVersion: 2n,
    policySalt: await domainHash('policy-salt', 'governed-private'),
    maxTransferAmount: 2_000n,
  };
  const operation: GovernanceOperation = { action: 'CHANGE_POLICY', newPolicy };
  const prepared = await prepareGovernance(f, operation, 'change-policy');
  const receipt = await f.engine.executeGovernance({ proposalCommitment: prepared.proposal.proposalCommitment, payload: prepared.payload, operation, nowSeconds: prepared.payload.createdAt + 10n });
  assert(receipt.policyVersion === 2n && f.engine.publicState.policyMode === 'PRIVATE_POLICY', 'governed policy update should activate v2');
  assert(f.engine.publicState.threshold === null, 'private threshold must disappear from public state');
});

await test('M13 policy version skipping is rejected', async () => {
  const f = await fixture();
  const badPolicy: TreasuryPolicy = { mode: 'STANDARD', threshold: 2, membershipVersion: 1n, policyVersion: 3n };
  const operation: GovernanceOperation = { action: 'CHANGE_POLICY', newPolicy: badPolicy };
  const prepared = await prepareGovernance(f, operation, 'bad-policy-version');
  await expectCode('NEW_POLICY_VERSION_INVALID', () => f.engine.executeGovernance({ proposalCommitment: prepared.proposal.proposalCommitment, payload: prepared.payload, operation, nowSeconds: prepared.payload.createdAt + 10n }));
});

await test('M14 governed cancellation permanently blocks a pending treasury proposal', async () => {
  const f = await fixture();
  const target = await f.engine.propose(f.transfer, f.member(f.alice, 0));
  const operation: GovernanceOperation = { action: 'CANCEL_PROPOSAL', targetProposalCommitment: target.proposalCommitment };
  const prepared = await prepareGovernance(f, operation, 'cancel-transfer');
  const receipt = await f.engine.executeGovernance({ proposalCommitment: prepared.proposal.proposalCommitment, payload: prepared.payload, operation, nowSeconds: prepared.payload.createdAt + 10n });
  assert(receipt.cancelledProposalCommitment === target.proposalCommitment, 'governance receipt should identify cancelled commitment');
  assert(f.engine.proposals.get(target.proposalCommitment)?.status === 'CANCELLED', 'target proposal must be cancelled');
  await expectCode('PROPOSAL_NOT_PENDING', () => f.engine.approve(target.proposalCommitment, f.member(f.bob, 1)));
});

await test('M14 governance receipt can be converted to privacy-safe Blackout Receipt', async () => {
  const f = await fixture();
  const operation: GovernanceOperation = { action: 'PAUSE' };
  const prepared = await prepareGovernance(f, operation, 'pause-receipt');
  const governance = await f.engine.executeGovernance({ proposalCommitment: prepared.proposal.proposalCommitment, payload: prepared.payload, operation, nowSeconds: prepared.payload.createdAt + 10n });
  const receipt = await buildGovernanceReferenceReceipt(governance);
  assert(receipt.statementType === 'SAFE_PAUSED', 'governance receipt statement must reflect pause');
  assert(receipt.publicInputs.safeStatus === 'PAUSED', 'receipt should expose only intended safe status');
});

// ---------------------------------------------------------------------------
// M15 hardening — state encapsulation / no backdoor transition surface
// ---------------------------------------------------------------------------

await test('M15 public Safe state is a snapshot and cannot mutate engine state', async () => {
  const f = await fixture();
  const snapshot = f.engine.publicState as { status: string };
  snapshot.status = 'PAUSED';
  assert(f.engine.publicState.status === 'ACTIVE', 'external snapshot mutation must not alter protocol state');
});

await test('M15 proposal snapshots cannot forge approval count or execution status', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.transfer, f.member(f.alice, 0));
  const snapshot = f.engine.proposals.get(proposal.proposalCommitment)!;
  snapshot.approvalCount = 999;
  snapshot.status = 'EXECUTED';
  const fresh = f.engine.proposals.get(proposal.proposalCommitment)!;
  assert(fresh.approvalCount === 0 && fresh.status === 'PENDING', 'external proposal mutation must not affect engine state');
});

await test('M15 no unilateral pause/resume/member-rotation API exists on protocol engine', async () => {
  const f = await fixture();
  const names = Object.getOwnPropertyNames(Object.getPrototypeOf(f.engine));
  assert(!names.includes('pause') && !names.includes('resume') && !names.includes('rotateMembership'), 'production-style state transitions must flow through executeGovernance');
  assert(names.includes('executeGovernance'), 'governance execution entry point must exist');
});

console.log(`\nBLACKOUT SAFE M10–M15 HARDENING TESTS: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) throw new Error(`${fail} test(s) failed`);
