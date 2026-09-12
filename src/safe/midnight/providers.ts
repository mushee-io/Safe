import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { createProofProvider, type MidnightProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { blackoutSafePrivateStateProvider } from './private-state.ts';
import { assertPreviewSession, requirePreviewDust, type SafeLaceSession } from './wallet-session.ts';

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const fromHex = (value: string): Uint8Array => {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-f]{2,}$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error('BLACKOUT_SAFE_INVALID_SERIALIZED_TX');
  }
  return new Uint8Array(hex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
};

export function safeMidnightError(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error) {
    if (error.message?.trim()) return error.message;
    if (error.cause && error.cause !== error) return safeMidnightError(error.cause, fallback);
    if (error.name && error.name !== 'Error') return error.name;
  }
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    for (const field of ['reason', 'message', 'code', 'type', '_tag', 'name']) {
      const candidate = value[field];
      if (typeof candidate === 'string' && candidate.trim()) return `${field}: ${candidate}`;
    }
  }
  return fallback;
}

export async function buildBlackoutSafeProviders(
  session: SafeLaceSession,
  zkAssetBaseUrl: string,
) {
  assertPreviewSession(session);
  await requirePreviewDust(session);
  setNetworkId('preview');

  if (typeof window === 'undefined') throw new Error('BLACKOUT_SAFE_BROWSER_REQUIRED');
  const { wallet, configuration, addresses } = session;
  const zkConfigProvider = new FetchZkConfigProvider(zkAssetBaseUrl, fetch.bind(window));
  const provingProvider = await wallet.getProvingProvider(zkConfigProvider.asKeyMaterialProvider());
  const proofProvider = createProofProvider(provingProvider);

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => addresses.shieldedCoinPublicKey as ledger.CoinPublicKey,
    getEncryptionPublicKey: () => addresses.shieldedEncryptionPublicKey as ledger.EncPublicKey,
    async balanceTx(tx) {
      try {
        const result = await wallet.balanceUnsealedTransaction(toHex(tx.serialize()), { payFees: true });
        return ledger.Transaction.deserialize(
          'signature',
          'proof',
          'binding',
          fromHex(result.tx),
        ) as ledger.FinalizedTransaction;
      } catch (error) {
        throw new Error(safeMidnightError(error, 'BLACKOUT_SAFE_BALANCE_TX_FAILED'));
      }
    },
  };

  const midnightProvider: MidnightProvider = {
    async submitTx(tx) {
      try {
        await wallet.submitTransaction(toHex(tx.serialize()));
        return tx.identifiers()[0];
      } catch (error) {
        throw new Error(safeMidnightError(error, 'BLACKOUT_SAFE_SUBMIT_TX_FAILED'));
      }
    },
  };

  return {
    privateStateProvider: blackoutSafePrivateStateProvider,
    zkConfigProvider,
    proofProvider,
    publicDataProvider: indexerPublicDataProvider(
      configuration.indexerUri!,
      configuration.indexerWsUri!,
    ),
    walletProvider,
    midnightProvider,
  };
}
