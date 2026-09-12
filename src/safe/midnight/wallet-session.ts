import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

export interface SafeLaceConfiguration {
  proverServerUri?: string;
  indexerUri?: string;
  indexerWsUri?: string;
}

export interface SafeShieldedAddresses {
  shieldedAddress?: string;
  shieldedCoinPublicKey?: string;
  shieldedEncryptionPublicKey?: string;
}

export interface SafeLaceSession {
  wallet: any;
  configuration: SafeLaceConfiguration;
  addresses: SafeShieldedAddresses;
  networkId: 'preview';
  walletName: string;
}

export interface DiscoveredSafeWallet {
  id: string;
  name: string;
  api: any;
}

let activeSession: SafeLaceSession | null = null;

export function getActiveSafeLaceSession(): SafeLaceSession | null {
  return activeSession;
}

export function clearActiveSafeLaceSession(): void {
  activeSession = null;
}

export function getInjectedSafeWallets(): DiscoveredSafeWallet[] {
  if (typeof window === 'undefined') return [];
  const candidateWindow = window as unknown as { midnight?: Record<string, any> };
  if (!candidateWindow.midnight || typeof candidateWindow.midnight !== 'object') return [];

  return Object.entries(candidateWindow.midnight)
    .filter(([, candidate]) => candidate && typeof candidate === 'object' && typeof candidate.connect === 'function')
    .map(([id, candidate]) => ({
      id,
      name: candidate.name || (id.toLowerCase().includes('lace') ? 'Lace (Midnight)' : id),
      api: candidate,
    }));
}

export function readDustBalance(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (value && typeof value === 'object' && 'balance' in value) {
    return readDustBalance((value as { balance: unknown }).balance);
  }
  throw new Error('BLACKOUT_SAFE_UNREADABLE_DUST_BALANCE');
}

export function assertPreviewSession(session: SafeLaceSession): void {
  if (session.networkId !== 'preview') throw new Error('BLACKOUT_SAFE_PREVIEW_ONLY');
  if (!session.configuration.indexerUri || !session.configuration.indexerWsUri) {
    throw new Error('BLACKOUT_SAFE_INDEXER_CONFIGURATION_MISSING');
  }
  if (!session.addresses.shieldedCoinPublicKey || !session.addresses.shieldedEncryptionPublicKey) {
    throw new Error('BLACKOUT_SAFE_SHIELDED_KEYS_MISSING');
  }
  if (typeof session.wallet.getProvingProvider !== 'function') {
    throw new Error('BLACKOUT_SAFE_WALLET_PROVING_UNAVAILABLE');
  }
  if (typeof session.wallet.balanceUnsealedTransaction !== 'function') {
    throw new Error('BLACKOUT_SAFE_WALLET_BALANCER_UNAVAILABLE');
  }
  if (typeof session.wallet.submitTransaction !== 'function') {
    throw new Error('BLACKOUT_SAFE_WALLET_SUBMIT_UNAVAILABLE');
  }
}

export async function requirePreviewDust(session: SafeLaceSession): Promise<bigint> {
  assertPreviewSession(session);
  if (typeof session.wallet.getDustBalance !== 'function') {
    throw new Error('BLACKOUT_SAFE_DUST_BALANCE_UNAVAILABLE');
  }
  const dust = readDustBalance(await session.wallet.getDustBalance());
  if (dust <= 0n) throw new Error('BLACKOUT_SAFE_ZERO_DUST');
  return dust;
}

/**
 * Connects only to the official DApp Connector v4 Preview path. There is no
 * demo fallback in this module; callers must handle connection failure.
 */
export async function connectBlackoutSafeLace(): Promise<SafeLaceSession> {
  if (typeof window === 'undefined') throw new Error('BLACKOUT_SAFE_BROWSER_REQUIRED');
  const wallets = getInjectedSafeWallets();
  if (wallets.length === 0) throw new Error('BLACKOUT_SAFE_LACE_NOT_DETECTED');

  const selected = wallets.find((wallet) =>
    wallet.id.toLowerCase().includes('lace') || wallet.name.toLowerCase().includes('lace')
  ) ?? wallets[0];

  const connected = await selected.api.connect('preview');
  const configuration = await connected.getConfiguration();
  const connectionStatus = await connected.getConnectionStatus();
  if (connectionStatus?.status !== 'connected' || connectionStatus.networkId !== 'preview') {
    throw new Error('BLACKOUT_SAFE_LACE_NOT_ON_PREVIEW');
  }

  setNetworkId('preview');
  if (typeof connected.hintUsage === 'function') {
    await connected.hintUsage([
      'getShieldedAddresses',
      'getDustBalance',
      'getProvingProvider',
      'balanceUnsealedTransaction',
      'submitTransaction',
    ]);
  }

  const addresses = typeof connected.getShieldedAddresses === 'function'
    ? await connected.getShieldedAddresses()
    : {};

  const session: SafeLaceSession = {
    wallet: connected,
    configuration,
    addresses,
    networkId: 'preview',
    walletName: selected.name,
  };
  assertPreviewSession(session);
  await requirePreviewDust(session);
  activeSession = session;
  return session;
}
