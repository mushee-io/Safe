import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { disposeBlackoutSafePrivateStateScope } from './private-state.ts';
import { assertSafeEndpointUri } from './security-hardening.ts';

export interface SafeLaceConfiguration {
  proverServerUri?: string;
  indexerUri?: string;
  indexerWsUri?: string;
  substrateNodeUri?: string;
  networkId?: string;
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
  connectorId: string;
  connectorRdns?: string;
  connectorApiVersion?: string;
}

export interface DiscoveredSafeWallet {
  id: string;
  name: string;
  rdns?: string;
  apiVersion?: string;
  api: any;
}

let activeSession: SafeLaceSession | null = null;

export function getActiveSafeLaceSession(): SafeLaceSession | null {
  return activeSession;
}

export function clearActiveSafeLaceSession(): void {
  if (activeSession) disposeBlackoutSafePrivateStateScope(activeSession);
  activeSession = null;
}

function isLaceDescriptor(wallet: Pick<DiscoveredSafeWallet, 'name' | 'rdns'>): boolean {
  const descriptor = `${wallet.name} ${wallet.rdns ?? ''}`.toLowerCase();
  return descriptor.includes('lace');
}

export function getInjectedSafeWallets(): DiscoveredSafeWallet[] {
  if (typeof window === 'undefined') return [];
  const candidateWindow = window as unknown as { midnight?: Record<string, any> };
  if (!candidateWindow.midnight || typeof candidateWindow.midnight !== 'object') return [];

  const seenApis = new Set<any>();
  const wallets: DiscoveredSafeWallet[] = [];
  for (const [id, candidate] of Object.entries(candidateWindow.midnight)) {
    if (!candidate || typeof candidate !== 'object' || typeof candidate.connect !== 'function') continue;
    if (seenApis.has(candidate)) continue; // Lace may expose a UUID entry plus the mnLace alias.
    seenApis.add(candidate);
    wallets.push({
      id,
      name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : id,
      rdns: typeof candidate.rdns === 'string' ? candidate.rdns : undefined,
      apiVersion: typeof candidate.apiVersion === 'string' ? candidate.apiVersion : undefined,
      api: candidate,
    });
  }
  return wallets;
}

export function readDustBalance(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (value && typeof value === 'object' && 'balance' in value) {
    return readDustBalance((value as { balance: unknown }).balance);
  }
  throw new Error('BLACKOUT_SAFE_UNREADABLE_DUST_BALANCE');
}

function normalizedConfiguration(configuration: SafeLaceConfiguration): SafeLaceConfiguration {
  return {
    ...configuration,
    indexerUri: assertSafeEndpointUri(configuration.indexerUri, 'HTTP'),
    indexerWsUri: assertSafeEndpointUri(configuration.indexerWsUri, 'WS'),
  };
}

export function assertPreviewSession(session: SafeLaceSession): void {
  if (session.networkId !== 'preview') throw new Error('BLACKOUT_SAFE_PREVIEW_ONLY');
  if (session.configuration.networkId && session.configuration.networkId !== 'preview') {
    throw new Error('BLACKOUT_SAFE_CONFIGURATION_NOT_PREVIEW');
  }
  if (!isLaceDescriptor({ name: session.walletName, rdns: session.connectorRdns })) {
    throw new Error('BLACKOUT_SAFE_NON_LACE_CONNECTOR_REJECTED');
  }
  normalizedConfiguration(session.configuration);
  if (!session.addresses.shieldedCoinPublicKey || !session.addresses.shieldedEncryptionPublicKey) {
    throw new Error('BLACKOUT_SAFE_SHIELDED_KEYS_MISSING');
  }
  if (typeof session.wallet.getConnectionStatus !== 'function') {
    throw new Error('BLACKOUT_SAFE_CONNECTION_STATUS_UNAVAILABLE');
  }
  if (typeof session.wallet.getConfiguration !== 'function') {
    throw new Error('BLACKOUT_SAFE_CONFIGURATION_UNAVAILABLE');
  }
  if (typeof session.wallet.getShieldedAddresses !== 'function') {
    throw new Error('BLACKOUT_SAFE_SHIELDED_ADDRESS_API_UNAVAILABLE');
  }
  if (typeof session.wallet.getDustBalance !== 'function') {
    throw new Error('BLACKOUT_SAFE_DUST_BALANCE_UNAVAILABLE');
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
  const dust = readDustBalance(await session.wallet.getDustBalance());
  if (dust <= 0n) throw new Error('BLACKOUT_SAFE_ZERO_DUST');
  return dust;
}

/** Re-check mutable wallet state immediately before every LIVE provider build. */
export async function revalidateBlackoutSafeLaceSession(session: SafeLaceSession): Promise<void> {
  assertPreviewSession(session);
  const status = await session.wallet.getConnectionStatus();
  if (status?.status !== 'connected' || status.networkId !== 'preview') {
    throw new Error('BLACKOUT_SAFE_LACE_SESSION_CHANGED');
  }

  const latestConfiguration = normalizedConfiguration(await session.wallet.getConfiguration());
  const expectedConfiguration = normalizedConfiguration(session.configuration);
  if (
    latestConfiguration.indexerUri !== expectedConfiguration.indexerUri ||
    latestConfiguration.indexerWsUri !== expectedConfiguration.indexerWsUri ||
    (latestConfiguration.networkId && latestConfiguration.networkId !== 'preview')
  ) {
    throw new Error('BLACKOUT_SAFE_NETWORK_CONFIGURATION_CHANGED');
  }

  const latestAddresses = await session.wallet.getShieldedAddresses();
  if (
    latestAddresses?.shieldedCoinPublicKey !== session.addresses.shieldedCoinPublicKey ||
    latestAddresses?.shieldedEncryptionPublicKey !== session.addresses.shieldedEncryptionPublicKey
  ) {
    throw new Error('BLACKOUT_SAFE_WALLET_ACCOUNT_CHANGED');
  }
  await requirePreviewDust(session);
}

/**
 * Connects only to a Lace-labelled DApp Connector v4 Preview wallet. There is
 * no fallback to an arbitrary injected connector and no demo fallback.
 */
export async function connectBlackoutSafeLace(): Promise<SafeLaceSession> {
  if (typeof window === 'undefined') throw new Error('BLACKOUT_SAFE_BROWSER_REQUIRED');
  const wallets = getInjectedSafeWallets();
  const laceWallets = wallets.filter(isLaceDescriptor);
  if (laceWallets.length === 0) throw new Error('BLACKOUT_SAFE_LACE_NOT_DETECTED');
  if (laceWallets.length > 1) throw new Error('BLACKOUT_SAFE_AMBIGUOUS_LACE_CONNECTORS');
  const selected = laceWallets[0];

  const connected = await selected.api.connect('preview');
  const rawConfiguration = await connected.getConfiguration();
  const configuration = normalizedConfiguration(rawConfiguration);
  const connectionStatus = await connected.getConnectionStatus();
  if (connectionStatus?.status !== 'connected' || connectionStatus.networkId !== 'preview') {
    throw new Error('BLACKOUT_SAFE_LACE_NOT_ON_PREVIEW');
  }
  if (configuration.networkId && configuration.networkId !== 'preview') {
    throw new Error('BLACKOUT_SAFE_CONFIGURATION_NOT_PREVIEW');
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

  const addresses = await connected.getShieldedAddresses();
  const session: SafeLaceSession = {
    wallet: connected,
    configuration,
    addresses,
    networkId: 'preview',
    walletName: selected.name,
    connectorId: selected.id,
    connectorRdns: selected.rdns,
    connectorApiVersion: selected.apiVersion,
  };
  await revalidateBlackoutSafeLaceSession(session);
  if (activeSession && activeSession !== session) disposeBlackoutSafePrivateStateScope(activeSession);
  activeSession = session;
  return session;
}
