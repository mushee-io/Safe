import { buildMembershipTree, deriveMemberCommitment, domainHash } from './crypto.ts';
import type { BlackoutReceiptEnvelope, PrivateMemberMaterial, PrivateProposalPayload, TreasuryPolicy } from './model.ts';
import { BlackoutSafeReferenceEngine, SafeProtocolError } from './reference-engine.ts';
import { buildQuorumReferenceReceipt, verifyBlackoutReceipt } from './receipts.ts';
import {
  assertCircuitArity,
  assertContractAddress,
  assertSafeEndpointUri,
  assertTransactionId,
  resolvePinnedAssetBaseUrl,
  sanitizeMidnightErrorMessage,
} from './midnight/security-hardening.ts';
import {
  disposeBlackoutSafePrivateStateScope,
  getBlackoutSafePrivateStateProvider,
} from './midnight/private-state.ts';
import {
  assertPreviewSession,
  revalidateBlackoutSafeLaceSession,
  type SafeLaceSession,
} from './midnight/wallet-session.ts';

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

function expectMessage(expected: string, fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    assert(error instanceof Error, 'expected Error');
    assert(error.message === expected, `expected ${expected}, got ${error.message}`);
    return;
  }
  throw new Error(`expected ${expected}`);
}

async function expectProtocolCode(expected: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof SafeProtocolError, `expected SafeProtocolError, got ${String(error)}`);
    assert(error.code === expected, `expected ${expected}, got ${error.code}`);
    return;
  }
  throw new Error(`expected ${expected}`);
}

async function referenceFixture() {
  const memberSecret = await domainHash('blackout:safe:hardening:member:v1', 'alice');
  const memberCommitment = await deriveMemberCommitment(memberSecret);
  const tree = await buildMembershipTree([memberCommitment], 4);
  const safeId = await domainHash('blackout:safe:hardening:safe:v1', 'safe');
  const policy: TreasuryPolicy = {
    mode: 'STANDARD',
    threshold: 1,
    membershipVersion: 1n,
    policyVersion: 1n,
    maxTransferAmount: 1000n,
  };
  const engine = await BlackoutSafeReferenceEngine.create({ safeId, membershipRoot: tree.root, policy });
  const member: PrivateMemberMaterial = {
    memberSecret,
    memberCommitment,
    membershipProof: tree.proofs[0],
    membershipVersion: 1n,
  };
  const payload: PrivateProposalPayload = {
    safeId,
    actionType: 'TRANSFER',
    asset: await domainHash('blackout:safe:hardening:asset:v1', 'asset'),
    recipient: await domainHash('blackout:safe:hardening:recipient:v1', 'recipient'),
    amount: 25n,
    calldataOrAction: await domainHash('blackout:safe:hardening:action:v1', 'transfer'),
    memoHash: await domainHash('blackout:safe:hardening:memo:v1', 'memo'),
    createdAt: 1_800_000_000n,
    expiresAt: 1_800_003_600n,
    nonce: await domainHash('blackout:safe:hardening:nonce:v1', 'nonce'),
    salt: await domainHash('blackout:safe:hardening:salt:v1', 'salt'),
  };
  return { engine, member, payload, policy };
}

await test('H1 ZK artifacts are pinned to the same HTTPS origin and exact Safe path', () => {
  const url = resolvePinnedAssetBaseUrl('/zk-artifacts/blackout-safe', 'https://safe.example');
  assert(url === 'https://safe.example/zk-artifacts/blackout-safe', 'pinned asset URL mismatch');
  expectMessage('BLACKOUT_SAFE_ZK_ASSET_PATH_NOT_PINNED', () =>
    resolvePinnedAssetBaseUrl('https://evil.example/keys', 'https://safe.example'));
});

await test('H2 insecure or credential-bearing indexer endpoints fail closed', () => {
  expectMessage('BLACKOUT_SAFE_INDEXER_HTTPS_REQUIRED', () => assertSafeEndpointUri('http://indexer.example', 'HTTP'));
  expectMessage('BLACKOUT_SAFE_WS_ENDPOINT_CREDENTIALS_FORBIDDEN', () =>
    assertSafeEndpointUri('wss://user:pass@indexer.example/ws', 'WS'));
  assert(assertSafeEndpointUri('http://localhost:8080', 'HTTP').startsWith('http://localhost:8080'), 'localhost dev HTTP should remain supported');
});

await test('H3 wallet/SDK errors redact large serialized hex payloads and credentials', () => {
  const raw = `failed https://alice:secret@example.test ${'ab'.repeat(128)}`;
  const safe = sanitizeMidnightErrorMessage(raw, 'fallback');
  assert(!safe.includes('alice:secret'), 'URL credentials leaked');
  assert(!safe.includes('abababababababababababababababab'), 'serialized hex leaked');
  assert(safe.includes('[REDACTED]') && safe.includes('[REDACTED_HEX_PAYLOAD]'), 'redaction markers missing');
});

await test('H4 circuit arity rejects malformed transaction requests before wallet access', () => {
  assertCircuitArity('approve_private', [new Uint8Array(32)], { approve_private: 1 });
  expectMessage('BLACKOUT_SAFE_APPROVE_PRIVATE_ARGUMENT_COUNT_MISMATCH', () =>
    assertCircuitArity('approve_private', [], { approve_private: 1 }));
  expectMessage('BLACKOUT_SAFE_UNKNOWN_CIRCUIT', () =>
    assertCircuitArity('evil_circuit', [], { approve_private: 1 }));
});

await test('H5 non-Lace injected session descriptors are rejected even if API methods exist', () => {
  const session = {
    wallet: {
      getConnectionStatus() {}, getConfiguration() {}, getShieldedAddresses() {}, getDustBalance() {},
      getProvingProvider() {}, balanceUnsealedTransaction() {}, submitTransaction() {},
    },
    configuration: { indexerUri: 'https://indexer.example', indexerWsUri: 'wss://indexer.example', networkId: 'preview' },
    addresses: { shieldedCoinPublicKey: 'coin', shieldedEncryptionPublicKey: 'enc' },
    networkId: 'preview',
    walletName: 'Unknown Wallet',
    connectorId: 'unknown',
    connectorRdns: 'wallet.example',
  } as SafeLaceSession;
  expectMessage('BLACKOUT_SAFE_NON_LACE_CONNECTOR_REJECTED', () => assertPreviewSession(session));
});

await test('H6 a wallet account/network mutation is detected before the next LIVE call', async () => {
  let addresses = { shieldedCoinPublicKey: 'coin-a', shieldedEncryptionPublicKey: 'enc-a' };
  const session = {
    wallet: {
      async getConnectionStatus() { return { status: 'connected', networkId: 'preview' }; },
      async getConfiguration() { return { indexerUri: 'https://indexer.example', indexerWsUri: 'wss://indexer.example', networkId: 'preview' }; },
      async getShieldedAddresses() { return addresses; },
      async getDustBalance() { return { balance: 10n }; },
      async getProvingProvider() { return {}; },
      async balanceUnsealedTransaction() { return { tx: '00' }; },
      async submitTransaction() {},
    },
    configuration: { indexerUri: 'https://indexer.example/', indexerWsUri: 'wss://indexer.example/', networkId: 'preview' },
    addresses: { ...addresses },
    networkId: 'preview',
    walletName: 'Lace',
    connectorId: 'lace-test',
    connectorRdns: 'io.lace.wallet',
  } as SafeLaceSession;
  await revalidateBlackoutSafeLaceSession(session);
  addresses = { shieldedCoinPublicKey: 'coin-b', shieldedEncryptionPublicKey: 'enc-b' };
  let failed = false;
  try { await revalidateBlackoutSafeLaceSession(session); } catch (error) {
    failed = error instanceof Error && error.message === 'BLACKOUT_SAFE_WALLET_ACCOUNT_CHANGED';
  }
  assert(failed, 'account switch must invalidate the session');
});

await test('H7 Safe private-state/signing-key providers do not cross wallet-session scopes', async () => {
  const scopeA = {};
  const scopeB = {};
  const providerA = getBlackoutSafePrivateStateProvider(scopeA);
  const providerB = getBlackoutSafePrivateStateProvider(scopeB);
  assert(providerA !== providerB, 'wallet scopes must receive distinct providers');
  await providerA.setSigningKey('contract-a' as never, 'secret-a' as never);
  assert(await providerB.getSigningKey('contract-a' as never) === null, 'signing key crossed wallet scope');
});

await test('H8 unsupported proposal action types fail before entering reference protocol state', async () => {
  const f = await referenceFixture();
  const unsupported = { ...f.payload, actionType: 'INVOICE' as const };
  await expectProtocolCode('UNSUPPORTED_ACTION_TYPE', () => f.engine.propose(unsupported, f.member));
  assert(f.engine.proposals.size === 0, 'unsupported proposal must not mutate proposal state');
});

await test('H9 historical quorum remains provable against the proposal policy snapshot after policy rotation', async () => {
  const f = await referenceFixture();
  const proposal = await f.engine.propose(f.payload, f.member);
  await f.engine.approve(proposal.proposalCommitment, f.member);
  const snapshot = f.engine.proposals.get(proposal.proposalCommitment);
  assert(snapshot?.policyCommitment === f.engine.publicState.policyCommitment, 'proposal must snapshot active policy commitment');

  const nextPolicy: TreasuryPolicy = {
    ...f.policy,
    policyVersion: 2n,
    maxTransferAmount: 500n,
  };
  await f.engine.rotatePolicyForReferenceTests(nextPolicy);
  await expectProtocolCode('PROPOSAL_STALE_POLICY', () => f.engine.proveQuorum(proposal.proposalCommitment));
  const historical = await f.engine.proveHistoricalQuorum(proposal.proposalCommitment, f.policy);
  assert(historical.valid, 'historical quorum proof should survive later policy rotation');
  assert(historical.policyVersion === 1n, 'historical receipt must preserve original policy version');
});

await test('H10 disposed wallet session scope cannot reuse stale signing/private state provider references', async () => {
  const scope = {};
  const provider = getBlackoutSafePrivateStateProvider(scope);
  await provider.setSigningKey('contract-a' as never, 'secret-a' as never);
  disposeBlackoutSafePrivateStateScope(scope);
  let failed = false;
  try { await provider.getSigningKey('contract-a' as never); } catch (error) {
    failed = error instanceof Error && error.message === 'BLACKOUT_SAFE_PRIVATE_STATE_PROVIDER_DISPOSED';
  }
  assert(failed, 'disposed session provider must be permanently invalidated');
  const replacement = getBlackoutSafePrivateStateProvider(scope);
  assert(replacement !== provider, 'reconnected session must receive a fresh provider instance');
});

await test('H11 malformed receipt identifiers are rejected before a proof verifier is invoked', async () => {
  const f = await referenceFixture();
  const proposal = await f.engine.propose(f.payload, f.member);
  await f.engine.approve(proposal.proposalCommitment, f.member);
  const quorum = await f.engine.proveQuorum(proposal.proposalCommitment);
  const receipt = await buildQuorumReferenceReceipt(quorum);
  const malformed = { ...receipt, safeId: '0x1234' } as BlackoutReceiptEnvelope;
  let verifierCalled = false;
  const result = await verifyBlackoutReceipt(malformed, {
    async verifyReceipt() { verifierCalled = true; return true; },
  }, 'LIVE');
  assert(!result.valid && result.code === 'RECEIPT_INTEGRITY_MISMATCH', 'malformed receipt must fail integrity');
  assert(!verifierCalled, 'proof verifier must not see malformed receipt data');
});

await test('H12 reference receipts cannot smuggle a purported proof into LIVE verification', async () => {
  const f = await referenceFixture();
  const proposal = await f.engine.propose(f.payload, f.member);
  await f.engine.approve(proposal.proposalCommitment, f.member);
  const quorum = await f.engine.proveQuorum(proposal.proposalCommitment);
  const receipt = await buildQuorumReferenceReceipt(quorum);
  const smuggled = { ...receipt, proof: 'pretend-proof' } as BlackoutReceiptEnvelope;
  const result = await verifyBlackoutReceipt(smuggled, { async verifyReceipt() { return true; } }, 'LIVE');
  assert(!result.valid && result.code === 'RECEIPT_INTEGRITY_MISMATCH', 'reference receipt with fake proof must fail closed');
});

await test('H13 official Midnight contract-address prefixes normalize to canonical raw 64-hex', () => {
  const raw = 'ab'.repeat(32);
  assert(assertContractAddress(raw, 'ADDRESS') === raw, 'raw address should remain unchanged');
  assert(assertContractAddress(`0x${raw}`, 'ADDRESS') === raw, '0x address should normalize');
  assert(assertContractAddress(`0200${raw}`, 'ADDRESS') === raw, '0200 contract prefix should normalize');
  assert(assertContractAddress(`0x0200${raw}`, 'ADDRESS') === raw, 'combined prefixes should normalize');
  assert(assertTransactionId(`0x${raw}`, 'TX') === raw, '0x tx id should normalize');
  expectMessage('TX_MUST_BE_64_HEX', () => assertTransactionId(`0200${raw}`, 'TX'));
});

console.log(`\nBLACKOUT SAFE SECURITY HARDENING TESTS: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) throw new Error(`${fail} security hardening test(s) failed`);
