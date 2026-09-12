import {
  buildMembershipTree,
  computeProposalCommitment,
  computeProposalNullifier,
  deriveMemberCommitment,
  domainHash,
  verifyMembershipProof,
} from './crypto.ts';
import { BlackoutSafeReferenceEngine, SafeProtocolError } from './reference-engine.ts';
import type { Hex32, PrivateMemberMaterial, PrivateProposalPayload } from './model.ts';
import { assertProposalCommitmentMatches, openAndVerifyProposal, ProposalIntegrityError } from './proposal-integrity.ts';

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
  return domainHash('blackout:safe:test-secret:v1', label);
}

async function material(label: string, version = 1n): Promise<{ secret: Hex32; commitment: Hex32 }> {
  const memberSecret = await secret(label);
  return { secret: memberSecret, commitment: await deriveMemberCommitment(memberSecret) };
}

async function fixture() {
  const alice = await material('alice');
  const bob = await material('bob');
  const carol = await material('carol');
  const mallory = await material('mallory');
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

  return { alice, bob, carol, mallory, tree, safeId, engine, member, payload };
}

await test('authorized member Merkle proof verifies', async () => {
  const f = await fixture();
  assert(await verifyMembershipProof(f.alice.commitment, f.tree.proofs[0], f.tree.root), 'Alice proof should verify');
});

await test('outsider cannot reuse an authorized member path', async () => {
  const f = await fixture();
  assert(!(await verifyMembershipProof(f.mallory.commitment, f.tree.proofs[0], f.tree.root)), 'Mallory must fail');
});

await test('tampered Merkle proof fails', async () => {
  const f = await fixture();
  const tampered = { ...f.tree.proofs[0], siblings: [...f.tree.proofs[0].siblings] };
  tampered.siblings[0] = await domainHash('tamper', 'sibling');
  assert(!(await verifyMembershipProof(f.alice.commitment, tampered, f.tree.root)), 'tampered proof must fail');
});

await test('proposal commitment changes if recipient changes', async () => {
  const f = await fixture();
  const a = await computeProposalCommitment(f.payload);
  const b = await computeProposalCommitment({ ...f.payload, recipient: await domainHash('recipient', 'attacker') });
  assert(a !== b, 'recipient mutation must alter commitment');
});

await test('proposal commitment changes if amount changes', async () => {
  const f = await fixture();
  const a = await computeProposalCommitment(f.payload);
  const b = await computeProposalCommitment({ ...f.payload, amount: 501n });
  assert(a !== b, 'amount mutation must alter commitment');
});

await test('proposal commitment changes if nonce changes', async () => {
  const f = await fixture();
  const a = await computeProposalCommitment(f.payload);
  const b = await computeProposalCommitment({ ...f.payload, nonce: await domainHash('nonce', 'proposal-2') });
  assert(a !== b, 'nonce mutation must alter commitment');
});

await test('proposal-scoped nullifier is deterministic for same member/proposal', async () => {
  const f = await fixture();
  const proposal = await computeProposalCommitment(f.payload);
  const n1 = await computeProposalNullifier(f.safeId, proposal, f.alice.secret);
  const n2 = await computeProposalNullifier(f.safeId, proposal, f.alice.secret);
  assert(n1 === n2, 'same member/proposal must produce same nullifier');
});

await test('same member gets unlinkable-by-value nullifier across different proposals', async () => {
  const f = await fixture();
  const p1 = await computeProposalCommitment(f.payload);
  const p2 = await computeProposalCommitment({ ...f.payload, nonce: await domainHash('nonce', 'proposal-x') });
  const n1 = await computeProposalNullifier(f.safeId, p1, f.alice.secret);
  const n2 = await computeProposalNullifier(f.safeId, p2, f.alice.secret);
  assert(n1 !== n2, 'proposal scoping must change nullifier');
});

await test('authorized member can create private proposal commitment', async () => {
  const f = await fixture();
  const receipt = await f.engine.propose(f.payload, f.member(f.alice, 0));
  assert(receipt.status === 'PENDING', 'proposal should be pending');
  const serialized = JSON.stringify(receipt, (_, value) => typeof value === 'bigint' ? value.toString() : value);
  assert(!serialized.includes(f.payload.recipient), 'receipt must not contain private recipient');
  assert(!serialized.includes('500'), 'receipt must not contain amount');
});

await test('outsider cannot create proposal', async () => {
  const f = await fixture();
  const fake: PrivateMemberMaterial = {
    memberSecret: f.mallory.secret,
    memberCommitment: f.mallory.commitment,
    membershipProof: f.tree.proofs[0],
    membershipVersion: 1n,
  };
  await expectCode('NOT_AUTHORIZED', () => f.engine.propose(f.payload, fake));
});

await test('first anonymous approval passes', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  const approval = await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  assert(approval.approvalCount === 1, 'count should be 1');
  assert(!approval.quorumSatisfied, '2-of-3 quorum should not yet be satisfied');
  const serialized = JSON.stringify(approval, (_, value) => typeof value === 'bigint' ? value.toString() : value);
  assert(!serialized.toLowerCase().includes('alice'), 'public approval must not contain member identity');
  assert(!serialized.includes(f.alice.commitment), 'public approval must not expose member commitment');
});

await test('same member cannot approve same proposal twice', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await expectCode('DUPLICATE_APPROVAL', () => f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0)));
});

await test('different authorized member satisfies 2-of-3 quorum', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  const second = await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  assert(second.approvalCount === 2, 'count should be 2');
  assert(second.quorumSatisfied, '2-of-3 quorum should be satisfied');
});

await test('member secret cannot open another member commitment', async () => {
  const f = await fixture();
  const forged: PrivateMemberMaterial = {
    memberSecret: f.mallory.secret,
    memberCommitment: f.alice.commitment,
    membershipProof: f.tree.proofs[0],
    membershipVersion: 1n,
  };
  await expectCode('MEMBER_SECRET_MISMATCH', () => f.engine.propose(f.payload, forged));
});

await test('stale member material fails after membership rotation', async () => {
  const f = await fixture();
  const newTree = await buildMembershipTree([f.bob.commitment, f.carol.commitment], 4);
  f.engine.rotateMembershipForReferenceTests(newTree.root);
  await expectCode('STALE_MEMBERSHIP', () => f.engine.propose(f.payload, f.member(f.alice, 0)));
});

await test('pending proposal bound to old membership epoch cannot accept approval', async () => {
  const f = await fixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  const newTree = await buildMembershipTree([f.bob.commitment, f.carol.commitment], 4);
  f.engine.rotateMembershipForReferenceTests(newTree.root);
  const bobNew: PrivateMemberMaterial = {
    memberSecret: f.bob.secret,
    memberCommitment: f.bob.commitment,
    membershipProof: newTree.proofs[0],
    membershipVersion: 2n,
  };
  await expectCode('PROPOSAL_STALE_MEMBERSHIP', () => f.engine.approve(proposal.proposalCommitment, bobNew));
});

await test('authorized client accepts decrypted proposal only when commitment matches', async () => {
  const f = await fixture();
  const commitment = await computeProposalCommitment(f.payload);
  await assertProposalCommitmentMatches(f.payload, commitment);
});

await test('authorized client rejects substituted decrypted proposal', async () => {
  const f = await fixture();
  const commitment = await computeProposalCommitment(f.payload);
  try {
    await assertProposalCommitmentMatches({ ...f.payload, amount: 999_999n }, commitment);
  } catch (error) {
    assert(error instanceof ProposalIntegrityError, 'expected ProposalIntegrityError');
    assert(error.code === 'COMMITMENT_MISMATCH', 'expected commitment mismatch');
    return;
  }
  throw new Error('substituted proposal was accepted');
});

await test('proposal distribution fails closed when no authenticated decryption adapter exists', async () => {
  const f = await fixture();
  const commitment = await computeProposalCommitment(f.payload);
  try {
    await openAndVerifyProposal({
      version: 1,
      proposalCommitment: commitment,
      algorithm: 'UNCONFIGURED',
      senderKeyId: 'none',
      nonce: '',
      ciphertext: '',
      authenticationTag: '',
    });
  } catch (error) {
    assert(error instanceof ProposalIntegrityError, 'expected ProposalIntegrityError');
    assert(error.code === 'DECRYPTION_UNAVAILABLE', 'expected fail-closed adapter error');
    return;
  }
  throw new Error('missing decryption adapter was silently accepted');
});

console.log(`\nBLACKOUT SAFE REFERENCE TESTS: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) throw new Error(`${fail} test(s) failed`);
