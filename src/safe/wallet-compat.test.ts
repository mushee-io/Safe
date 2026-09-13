import {
  assertPreviewSession,
  requirePreviewDust,
  supportedSafeWalletKind,
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

function session(kind: 'lace' | '1am', dust: bigint): SafeLaceSession {
  const is1am = kind === '1am';
  return {
    wallet: {
      async getConnectionStatus() { return { status: 'connected', networkId: 'preview' }; },
      async getConfiguration() {
        return {
          indexerUri: 'https://indexer.example',
          indexerWsUri: 'wss://indexer.example',
          networkId: 'preview',
        };
      },
      async getShieldedAddresses() {
        return { shieldedCoinPublicKey: 'coin', shieldedEncryptionPublicKey: 'enc' };
      },
      async getDustBalance() { return { balance: dust }; },
      async getProvingProvider() { return {}; },
      async balanceUnsealedTransaction() { return { tx: '00' }; },
      async submitTransaction() {},
    },
    configuration: {
      indexerUri: 'https://indexer.example/',
      indexerWsUri: 'wss://indexer.example/',
      networkId: 'preview',
    },
    addresses: { shieldedCoinPublicKey: 'coin', shieldedEncryptionPublicKey: 'enc' },
    networkId: 'preview',
    walletName: is1am ? '1AM' : 'Lace',
    connectorId: is1am ? '1am' : 'mnLace',
    connectorRdns: is1am ? 'xyz.1am.wallet' : 'io.lace.wallet',
    connectorApiVersion: '4.0.1',
    walletKind: kind,
  };
}

await test('W1 explicit allowlist recognizes Lace and 1AM only', () => {
  assert(supportedSafeWalletKind({ id: 'mnLace', name: 'Lace', rdns: 'io.lace.wallet' }) === 'lace', 'Lace not recognized');
  assert(supportedSafeWalletKind({ id: '1am', name: '1AM', rdns: 'xyz.1am.wallet' }) === '1am', '1AM not recognized');
  assert(supportedSafeWalletKind({ id: 'evil', name: 'Random Wallet', rdns: 'evil.example' }) === null, 'unknown wallet accepted');
});

await test('W2 1AM Preview session passes the same fail-closed API boundary', () => {
  assertPreviewSession(session('1am', 0n));
});

await test('W3 Lace still requires positive Preview DUST', async () => {
  let failed = false;
  try { await requirePreviewDust(session('lace', 0n)); } catch (error) {
    failed = error instanceof Error && error.message === 'BLACKOUT_SAFE_ZERO_DUST';
  }
  assert(failed, 'Lace zero-DUST session must fail closed');
});

await test('W4 1AM zero-DUST session remains usable for sponsored execution path', async () => {
  const dust = await requirePreviewDust(session('1am', 0n));
  assert(dust === 0n, '1AM zero balance should remain readable as zero');
});

await test('W5 wallet kind cannot contradict the injected connector descriptor', () => {
  const mismatched = { ...session('1am', 0n), walletKind: 'lace' as const };
  let failed = false;
  try { assertPreviewSession(mismatched); } catch (error) {
    failed = error instanceof Error && error.message === 'BLACKOUT_SAFE_UNSUPPORTED_CONNECTOR_REJECTED';
  }
  assert(failed, 'wallet-kind/descriptor mismatch must be rejected');
});

console.log(`\nBLACKOUT SAFE WALLET COMPAT TESTS: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) throw new Error(`${fail} wallet compatibility test(s) failed`);
