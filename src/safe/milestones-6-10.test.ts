import {
  buildMembershipTree,
  computePolicyCommitment,
  deriveMemberCommitment,
  domainHash,
} from './crypto.ts';
import { BlackoutSafeReferenceEngine, SafeProtocolError } from './reference-engine.ts';
import type { Hex32, PrivateMemberMaterial, PrivatePolicy, PrivateProposalPayload, TreasuryPolicy } from './model.ts';
import { ReferenceShieldedTreasury, UnavailableShieldedTreasury } from './treasury.ts';

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

async function memberMaterial(label: string): Promise<{ secret: Hex32; commitment: Hex32 }> {
  const secret = await domainHash('blackout:safe:test-secret:v1', label);
  return { secret, commitment: await deriveMemberCommitment(secret) };
}

async function fixture() {
  const alice = await memberMaterial('alice');
  const bob = await memberMaterial('bob');
  const carol = await memberMaterial('carol');
  const tree = await buildMembershipTree([alice.commitment, bob.commitment, carol.commitment], 4);
  const safeId = await domainHash('blackout:safe:test-safe:v1', 'safe-001');
  const engine = await BlackoutSafeReferenceEngine.create({
    safeId,
    membershipRoot: tree.root,
    policy: { mode: 'STANDARD', threshold: 2, membershipVersion: 1n, policyVersion: 1n },
  });
  const member = (entry: typeof alice, proofIndex: number): PrivateMemberMaterial => ({
    memberSecret: entry.secret,
    memberCommitment: entry.commitment,
    membershipProof: tree.proofs[proofIndex],
    membershipVersion: 1n,
  });
  const payload: PrivateProposalPayload = {
    safeId,
    actionType: 'TRANSFER',
    asset: await domainHash('asset', 'tNIGHT'),
    recipient: await domainHash('recipient', 'vendor-a'),
    amount: 500n,
    calldataOrAction: await domainHash('action', 'transfer'),
    memoHash: await domainHash('memo', 'invoice-4481'),
    createdAt: 1_700_000_000n,
    expiresAt: 1_700_086_400n,
    nonce: await domainHash('nonce', 'proposal-1'),
    salt: await domainHash('salt', 'proposal-1'),
  };
  return { alice, bob, carol, tree, safeId, engine, member, payload };
}

await test('policy engine rejects proposal above configured transfer ceiling', async () => {
  const f = await fixture();
  await f.engine.rotatePolicyForReferenceTests({
    mode: 'STANDARD', threshold: 2, membershipVersion: 1n, policyVersion: 2n, maxTransferAmount: 400n,
  });
  await expectCode('POLICY_AMOUNT_LIMIT', () => f.engine.propose(f.payload, f.member(f.alice, 0)));
});

await test('policy engine rejects proposal lifetime above configured maximum', async () => {
  const f = await fixture();
  await f.engine.rotatePolicyForReferenceTests({
    mode: 'STANDARD', threshold: 2, membershipVersion: 1n, policyVersion: 2n, maxProposalLifetimeSeconds: 3600n,
  });
  await expectCode('POLICY_LIFETIME_LIMIT', () => f.engine.propose(f.payload, f.member(f.alice, 0)));
});

await test('policy commitment changes when any security rule changes', async () => {
  const base: TreasuryPolicy = { mode: 'STANDARD', threshold: 2, membershipVersion: 1n, policyVersion: 1n };
  const a = await computePolicyCommitment(base);
  const b = await computePolicyCommitment({ ...base, threshold: 3 });
  const c = await computePolicyCommitment({ ...base, maxTransferAmount: 1000n });
  assert(a !== b && a !== c && b !== c, 'policy security changes must alter commitment');
});

await test('quorum proof fails below threshold and passes at exact threshold', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await expectCode('QUORUM_NOT_REACHED', () => f.engine.proveQuorum(proposal.proposalCommitment));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const receipt = await f.engine.proveQuorum(proposal.proposalCommitment);
  assert(receipt.valid && receipt.statement === 'QUORUM_AUTHORIZED', 'quorum statement should be valid');
  const serialized = JSON.stringify(receipt, (_, value) => typeof value === 'bigint' ? value.toString() : value);
  assert(!serialized.includes(f.alice.commitment) && !serialized.includes(f.bob.commitment), 'receipt must not reveal approvers');
});

await test('PRIVATE_POLICY hides threshold in public state and approval receipt', async () => {
  const f = await fixture();
  const policy: PrivatePolicy = {
    mode: 'PRIVATE_POLICY', threshold: 2, membershipVersion: 1n, policyVersion: 2n,
    policySalt: await domainHash('private-policy-salt', 'one'), maxTransferAmount: 1000n,
  };
  await f.engine.rotatePolicyForReferenceTests(policy);
  assert(f.engine.publicState.threshold === null, 'private threshold must not be public');
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  const approval = await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  assert(approval.quorumSatisfied === null, 'approval must not expose hidden threshold progression');
});

await test('PRIVATE_POLICY rejects wrong opening', async () => {
  const f = await fixture();
  const policy: PrivatePolicy = {
    mode: 'PRIVATE_POLICY', threshold: 2, membershipVersion: 1n, policyVersion: 2n,
    policySalt: await domainHash('private-policy-salt', 'correct'), maxTransferAmount: 1000n,
  };
  await f.engine.rotatePolicyForReferenceTests(policy);
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const wrong: PrivatePolicy = { ...policy, policySalt: await domainHash('private-policy-salt', 'wrong') };
  await expectCode('POLICY_COMMITMENT_MISMATCH', () => f.engine.proveQuorum(proposal.proposalCommitment, wrong));
});

await test('execution fails below quorum before touching treasury', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  const treasury = new ReferenceShieldedTreasury([{ tokenType: f.payload.asset, balance: 1000n }]);
  await expectCode('QUORUM_NOT_REACHED', () => f.engine.execute({
    proposalCommitment: proposal.proposalCommitment, payload: f.payload, nowSeconds: f.payload.createdAt + 10n, treasury,
  }));
  assert(await treasury.getSpendableBalance(f.payload.asset) === 1000n, 'failed execution must not debit treasury');
});

await test('execution enforces mandatory delay', async () => {
  const f = await fixture();
  await f.engine.rotatePolicyForReferenceTests({
    mode: 'STANDARD', threshold: 2, membershipVersion: 1n, policyVersion: 2n, minExecutionDelaySeconds: 3600n,
  });
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const treasury = new ReferenceShieldedTreasury([{ tokenType: f.payload.asset, balance: 1000n }]);
  await expectCode('EXECUTION_DELAY', () => f.engine.execute({
    proposalCommitment: proposal.proposalCommitment, payload: f.payload, nowSeconds: f.payload.createdAt + 3599n, treasury,
  }));
});

await test('execution rejects expired proposal', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const treasury = new ReferenceShieldedTreasury([{ tokenType: f.payload.asset, balance: 1000n }]);
  await expectCode('PROPOSAL_EXPIRED', () => f.engine.execute({
    proposalCommitment: proposal.proposalCommitment, payload: f.payload, nowSeconds: f.payload.expiresAt, treasury,
  }));
});

await test('execution rejects mutated payload before debit', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const treasury = new ReferenceShieldedTreasury([{ tokenType: f.payload.asset, balance: 1000n }]);
  await expectCode('PROPOSAL_COMMITMENT_MISMATCH', () => f.engine.execute({
    proposalCommitment: proposal.proposalCommitment, payload: { ...f.payload, amount: 600n },
    nowSeconds: f.payload.createdAt + 10n, treasury,
  }));
  assert(await treasury.getSpendableBalance(f.payload.asset) === 1000n, 'mutation failure must not debit treasury');
});

await test('execution fails closed on insufficient shielded funds', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const treasury = new ReferenceShieldedTreasury([{ tokenType: f.payload.asset, balance: 499n }]);
  await expectCode('INSUFFICIENT_FUNDS', () => f.engine.execute({
    proposalCommitment: proposal.proposalCommitment, payload: f.payload, nowSeconds: f.payload.createdAt + 10n, treasury,
  }));
});

await test('successful shielded execution debits exactly once and emits privacy-safe receipt', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const treasury = new ReferenceShieldedTreasury([{ tokenType: f.payload.asset, balance: 1000n }]);
  const receipt = await f.engine.execute({
    proposalCommitment: proposal.proposalCommitment, payload: f.payload, nowSeconds: f.payload.createdAt + 10n, treasury,
  });
  assert(receipt.status === 'EXECUTED' && receipt.policyCompliant && receipt.quorumSatisfied, 'execution receipt invalid');
  assert(await treasury.getSpendableBalance(f.payload.asset) === 500n, 'treasury must debit once');
  const serialized = JSON.stringify(receipt, (_, value) => typeof value === 'bigint' ? value.toString() : value);
  assert(!serialized.includes(f.payload.recipient), 'receipt must not expose private recipient');
  assert(!('amount' in receipt) && !('recipientCoinPublicKey' in receipt), 'receipt shape must omit private transfer fields');
});

await test('executed proposal cannot execute twice', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const treasury = new ReferenceShieldedTreasury([{ tokenType: f.payload.asset, balance: 1000n }]);
  await f.engine.execute({ proposalCommitment: proposal.proposalCommitment, payload: f.payload, nowSeconds: f.payload.createdAt + 10n, treasury });
  await expectCode('PROPOSAL_NOT_PENDING', () => f.engine.execute({
    proposalCommitment: proposal.proposalCommitment, payload: f.payload, nowSeconds: f.payload.createdAt + 11n, treasury,
  }));
  assert(await treasury.getSpendableBalance(f.payload.asset) === 500n, 'replay must not debit twice');
});

await test('proposal nonce cannot be reused with a different payload', async () => {
  const f = await fixture();
  await f.engine.propose(f.payload, f.member(f.alice, 0));
  const second = { ...f.payload, recipient: await domainHash('recipient', 'vendor-b'), salt: await domainHash('salt', 'proposal-b') };
  await expectCode('DUPLICATE_PROPOSAL_NONCE', () => f.engine.propose(second, f.member(f.bob, 1)));
});

await test('missing LIVE treasury adapter fails closed', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  try {
    await f.engine.execute({
      proposalCommitment: proposal.proposalCommitment, payload: f.payload,
      nowSeconds: f.payload.createdAt + 10n, treasury: new UnavailableShieldedTreasury(),
    });
  } catch (error) {
    assert(error instanceof Error && error.message.includes('No real Midnight shielded treasury adapter'), 'must expose missing adapter blocker');
    return;
  }
  throw new Error('missing LIVE treasury adapter was silently simulated');
});

await test('treasury transfer failure leaves proposal pending for safe retry', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  const failingTreasury = {
    async getSpendableBalance() { return 1000n; },
    async executeShieldedTransfer(): Promise<never> { throw new Error('synthetic transfer failure'); },
  };
  try {
    await f.engine.execute({
      proposalCommitment: proposal.proposalCommitment, payload: f.payload,
      nowSeconds: f.payload.createdAt + 10n, treasury: failingTreasury,
    });
  } catch (error) {
    assert(error instanceof Error && error.message === 'synthetic transfer failure', 'expected transfer failure');
  }
  assert(f.engine.proposals.get(proposal.proposalCommitment)?.status === 'PENDING', 'failed transfer must leave proposal pending');
  const healthy = new ReferenceShieldedTreasury([{ tokenType: f.payload.asset, balance: 1000n }]);
  const receipt = await f.engine.execute({
    proposalCommitment: proposal.proposalCommitment, payload: f.payload,
    nowSeconds: f.payload.createdAt + 11n, treasury: healthy,
  });
  assert(receipt.status === 'EXECUTED', 'retry should succeed');
});

await test('PRIVATE_POLICY executes at hidden exact threshold with committed amount limit', async () => {
  const f = await fixture();
  const policy: PrivatePolicy = {
    mode: 'PRIVATE_POLICY', threshold: 2, membershipVersion: 1n, policyVersion: 2n,
    policySalt: await domainHash('private-policy-salt', 'execution'), maxTransferAmount: 750n,
  };
  await f.engine.rotatePolicyForReferenceTests(policy);
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  assert(f.engine.publicState.threshold === null, 'private threshold must remain absent publicly');
  const treasury = new ReferenceShieldedTreasury([{ tokenType: f.payload.asset, balance: 1000n }]);
  const receipt = await f.engine.execute({
    proposalCommitment: proposal.proposalCommitment, payload: f.payload,
    nowSeconds: f.payload.createdAt + 10n, treasury, policyOpening: policy,
  });
  assert(receipt.policyCompliant && receipt.quorumSatisfied, 'private policy execution statement should succeed');
});

console.log(`\nBLACKOUT SAFE M6-10 TESTS: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) throw new Error(`${fail} test(s) failed`);
