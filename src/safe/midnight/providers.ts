import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { createProofProvider, type MidnightProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { BLACKOUT_SAFE_ZK_ASSET_PATH } from './compiled-safe-contract.ts';
import { getBlackoutSafePrivateStateProvider } from './private-state.ts';
import { resolvePinnedAssetBaseUrl, sanitizeMidnightErrorMessage } from './security-hardening.ts';
import { revalidateBlackoutSafeLaceSession, type SafeLaceSession } from './wallet-session.ts';

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
  if (typeof error === 'string') return sanitizeMidnightErrorMessage(error, fallback);
  if (error instanceof Error) {
    if (error.message?.trim()) return sanitizeMidnightErrorMessage(error.message, fallback);
    if (error.cause && error.cause !== error) return safeMidnightError(error.cause, fallback);
    if (error.name && error.name !== 'Error') return sanitizeMidnightErrorMessage(error.name, fallback);
  }
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    for (const field of ['reason', 'message', 'code', 'type', '_tag', 'name']) {
      const candidate = value[field];
      if (typeof candidate === 'string' && candidate.trim()) {
        return sanitizeMidnightErrorMessage(`${field}: ${candidate}`, fallback);
      }
    }
  }
  return fallback;
}

export async function buildBlackoutSafeProviders(session: SafeLaceSession) {
  await revalidateBlackoutSafeLaceSession(session);
  setNetworkId('preview');

  if (typeof window === 'undefined') throw new Error('BLACKOUT_SAFE_BROWSER_REQUIRED');
  const { wallet, configuration, addresses } = session;
  const zkAssetBaseUrl = resolvePinnedAssetBaseUrl(BLACKOUT_SAFE_ZK_ASSET_PATH, window.location.origin);
  const zkConfigProvider = new FetchZkConfigProvider(zkAssetBaseUrl, fetch.bind(window));
  const provingProvider = await wallet.getProvingProvider(zkConfigProvider.asKeyMaterialProvider());
  if (!provingProvider) throw new Error('BLACKOUT_SAFE_PROVING_PROVIDER_EMPTY');
  const proofProvider = createProofProvider(provingProvider);

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => addresses.shieldedCoinPublicKey as ledger.CoinPublicKey,
    getEncryptionPublicKey: () => addresses.shieldedEncryptionPublicKey as ledger.EncPublicKey,
    async balanceTx(tx) {
      try {
        const result = await wallet.balanceUnsealedTransaction(toHex(tx.serialize()), { payFees: true });
        if (!result || typeof result.tx !== 'string' || result.tx.length === 0) {
          throw new Error('BLACKOUT_SAFE_BALANCER_RETURNED_NO_TX');
        }
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
        const txId = tx.identifiers()[0];
        if (!txId) throw new Error('BLACKOUT_SAFE_SUBMITTED_TX_IDENTIFIER_MISSING');
        return txId;
      } catch (error) {
        throw new Error(safeMidnightError(error, 'BLACKOUT_SAFE_SUBMIT_TX_FAILED'));
      }
    },
  };

  return {
    privateStateProvider: getBlackoutSafePrivateStateProvider(session),
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
