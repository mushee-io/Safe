import { buildMembershipTree, deriveMemberCommitment, domainHash } from './crypto.ts';
import type { Hex32, PrivateMemberMaterial, PrivateProposalPayload, TreasuryPolicy } from './model.ts';
import { BlackoutSafeReferenceEngine, SafeProtocolError } from './reference-engine.ts';
import { createBlackoutSafePrivateStateProvider } from './midnight/private-state.ts';
import { assertPreviewSession, readDustBalance, type SafeLaceSession } from './midnight/wallet-session.ts';
import { deployBlackoutSafe } from './midnight/live-safe.ts';
import { evaluateBlackoutSafeRelease } from './release-gate.ts';

let pass = 0;
let fail = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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

async function expectMessage(message: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof Error, `expected Error, got ${String(error)}`);
    assert(error.message === message, `expected ${message}, got ${error.message}`);
    return;
  }
  throw new Error(`expected ${message}, but call succeeded`);
}

async function fiveMemberFixture() {
  const labels = ['alice', 'bob', 'carol', 'dave', 'erin', 'mallory'];
  const entries = await Promise.all(labels.map(async (label) => {
    const secret = await domainHash('blackout:safe:m15-20:secret:v1', label);
    return { label, secret, commitment: await deriveMemberCommitment(secret) };
  }));
  const [alice, bob, carol, dave, erin, mallory] = entries;
  const tree = await buildMembershipTree(
    [alice.commitment, bob.commitment, carol.commitment, dave.commitment, erin.commitment],
    4,
  );
  const safeId = await domainHash('blackout:safe:m15-20:safe:v1', 'five-member-safe');
  const policy: TreasuryPolicy = {
    mode: 'STANDARD',
    threshold: 3,
    membershipVersion: 1n,
    policyVersion: 1n,
    maxTransferAmount: 50_000n,
    maxProposalLifetimeSeconds: 86_400n,
  };
  const engine = await BlackoutSafeReferenceEngine.create({ safeId, membershipRoot: tree.root, policy });
  const member = (entry: typeof alice, index: number): PrivateMemberMaterial => ({
    memberSecret: entry.secret,
    memberCommitment: entry.commitment,
    membershipProof: tree.proofs[index],
    membershipVersion: 1n,
  });
  const payload: PrivateProposalPayload = {
    safeId,
    actionType: 'TRANSFER',
    asset: await domainHash('blackout:safe:m15-20:asset:v1', 'tNIGHT'),
    recipient: await domainHash('blackout:safe:m15-20:recipient:v1', 'vendor'),
    amount: 1_250n,
    calldataOrAction: await domainHash('blackout:safe:m15-20:action:v1', 'transfer'),
    memoHash: await domainHash('blackout:safe:m15-20:memo:v1', 'invoice-204'),
    createdAt: 1_800_000_000n,
    expiresAt: 1_800_043_200n,
    nonce: await domainHash('blackout:safe:m15-20:nonce:v1', 'transfer-1'),
    salt: await domainHash('blackout:safe:m15-20:salt:v1', 'transfer-1'),
  };
  return { alice, bob, carol, dave, erin, mallory, tree, safeId, policy, engine, member, payload };
}

await test('M19 five-member treasury reaches quorum only after three distinct authorized approvals', async () => {
  const f = await fiveMemberFixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.bob, 1));
  await expectCode('QUORUM_NOT_REACHED', () => f.engine.proveQuorum(proposal.proposalCommitment));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.carol, 2));
  const quorum = await f.engine.proveQuorum(proposal.proposalCommitment);
  assert(quorum.valid && quorum.statement === 'QUORUM_AUTHORIZED', '3-of-5 quorum must be valid');
});

await test('M19 outsider cannot participate in five-member treasury approval', async () => {
  const f = await fiveMemberFixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  const outsider: PrivateMemberMaterial = {
    memberSecret: f.mallory.secret,
    memberCommitment: f.mallory.commitment,
    membershipProof: f.tree.proofs[0],
    membershipVersion: 1n,
  };
  await expectCode('NOT_AUTHORIZED', () => f.engine.approve(proposal.proposalCommitment, outsider));
});

await test('M19 same member cannot count twice toward 3-of-5 quorum', async () => {
  const f = await fiveMemberFixture();
  const proposal = await f.engine.propose(f.payload, f.member(f.alice, 0));
  await f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0));
  await expectCode('DUPLICATE_APPROVAL', () => f.engine.approve(proposal.proposalCommitment, f.member(f.alice, 0)));
});

await test('M17 DUST parser accepts connector shapes and rejects fabricated/unreadable values', async () => {
  assert(readDustBalance({ balance: '42' }) === 42n, 'connector balance object should parse');
  assert(readDustBalance(9n) === 9n, 'bigint should parse');
  let failed = false;
  try { readDustBalance('12.5'); } catch { failed = true; }
  assert(failed, 'non-integer DUST must fail closed');
});

await test('M17 Preview session rejects missing shielded keys before any submission', async () => {
  const session = {
    wallet: {
      getProvingProvider() {},
      balanceUnsealedTransaction() {},
      submitTransaction() {},
    },
    configuration: { indexerUri: 'https://indexer', indexerWsUri: 'wss://indexer' },
    addresses: {},
    networkId: 'preview',
    walletName: 'test',
  } as SafeLaceSession;
  let failed = false;
  try { assertPreviewSession(session); } catch (error) {
    failed = error instanceof Error && error.message === 'BLACKOUT_SAFE_SHIELDED_KEYS_MISSING';
  }
  assert(failed, 'missing shielded keys must fail before transaction construction');
});

await test('M18 private policy deployment refuses a public threshold before wallet access', async () => {
  await expectMessage('BLACKOUT_SAFE_PRIVATE_POLICY_THRESHOLD_MUST_BE_ZERO', () => deployBlackoutSafe({
    safeId: new Uint8Array(32),
    membershipRoot: { field: 0n },
    policyCommitment: new Uint8Array(32),
    policyIsPrivate: true,
    standardRequiredQuorum: 2n,
  }));
});

await test('M16 Safe private-state export remains disabled', async () => {
  const provider = createBlackoutSafePrivateStateProvider();
  await expectMessage('BLACKOUT_SAFE_PRIVATE_STATE_EXPORT_DISABLED', () => provider.exportPrivateStates());
});

await test('M20 green build evidence opens Preview deployment but not production', async () => {
  const gate = evaluateBlackoutSafeRelease({
    fullZkArtifactsGenerated: true,
    compilerPinned0311: true,
    strictTypecheckPassed: true,
    protocolTestsPassed: true,
    generatedBindingIntegrated: true,
    lacePreviewProviderIntegrated: true,
    multiUserPreviewValidated: false,
    liveShieldedExecutionValidated: false,
    liveReceiptVerificationValidated: false,
  });
  assert(gate.stage === 'PREVIEW_READY', 'green build should be Preview-ready');
  assert(gate.readyForPreviewDeploy, 'Preview deploy gate should open');
  assert(!gate.readyForProduction, 'production must remain fail-closed');
});

await test('M20 fake deployment identifiers cannot advance the release gate', async () => {
  const gate = evaluateBlackoutSafeRelease({
    fullZkArtifactsGenerated: true,
    compilerPinned0311: true,
    strictTypecheckPassed: true,
    protocolTestsPassed: true,
    generatedBindingIntegrated: true,
    lacePreviewProviderIntegrated: true,
    previewDeploymentTxId: 'demo-tx',
    previewContractAddress: 'demo-address',
    multiUserPreviewValidated: true,
    liveShieldedExecutionValidated: true,
    liveReceiptVerificationValidated: true,
  });
  assert(gate.stage === 'PREVIEW_READY', 'non-chain identifiers must not count as deployment evidence');
  assert(!gate.deployedOnPreview, 'fake identifiers must not mark Preview deployed');
});

await test('M20 even complete Preview evidence still requires manual production security review', async () => {
  const id = 'ab'.repeat(32);
  const gate = evaluateBlackoutSafeRelease({
    fullZkArtifactsGenerated: true,
    compilerPinned0311: true,
    strictTypecheckPassed: true,
    protocolTestsPassed: true,
    generatedBindingIntegrated: true,
    lacePreviewProviderIntegrated: true,
    previewDeploymentTxId: id,
    previewContractAddress: id,
    multiUserPreviewValidated: true,
    liveShieldedExecutionValidated: true,
    liveReceiptVerificationValidated: true,
  });
  assert(gate.stage === 'PRODUCTION_BLOCKED', 'production must remain manually gated');
  assert(gate.blockers.includes('MANUAL_SECURITY_PRIVACY_REVIEW_REQUIRED_BEFORE_PRODUCTION'), 'manual review blocker must remain explicit');
  assert(!gate.readyForProduction, 'release gate must never auto-approve production');
});

console.log(`\nBLACKOUT SAFE M15-20 TESTS: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) throw new Error(`${fail} M15-20 test(s) failed`);
