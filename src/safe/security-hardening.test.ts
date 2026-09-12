import {
  assertCircuitArity,
  assertSafeEndpointUri,
  resolvePinnedAssetBaseUrl,
  sanitizeMidnightErrorMessage,
} from './midnight/security-hardening.ts';
import { getBlackoutSafePrivateStateProvider } from './midnight/private-state.ts';
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

console.log(`\nBLACKOUT SAFE SECURITY HARDENING TESTS: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) throw new Error(`${fail} security hardening test(s) failed`);
