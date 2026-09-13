import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { disposeBlackoutSafePrivateStateScope } from './private-state.ts';
import { assertSafeEndpointUri } from './security-hardening.ts';

export type SupportedSafeWalletKind = 'lace' | '1am';

const WALLET_DETECT_TIMEOUT_MS = 6_000;
const WALLET_DETECT_INTERVAL_MS = 250;
const WALLET_REGISTRY_SETTLE_MS = 500;

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

/**
 * Historical name kept for compatibility with the rest of BLACKOUT SAFE.
 * The session may now be backed by either Lace or 1AM, both through Midnight
 * DApp Connector v4 on Preview.
 */
export interface SafeLaceSession {
  wallet: any;
  configuration: SafeLaceConfiguration;
  addresses: SafeShieldedAddresses;
  networkId: 'preview';
  walletName: string;
  connectorId: string;
  connectorRdns?: string;
  connectorApiVersion?: string;
  walletKind?: SupportedSafeWalletKind;
}

export type SafeWalletSession = SafeLaceSession;
export type SafeWalletConfiguration = SafeLaceConfiguration;

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

export const getActiveSafeWalletSession = getActiveSafeLaceSession;

export function clearActiveSafeLaceSession(): void {
  if (activeSession) disposeBlackoutSafePrivateStateScope(activeSession);
  activeSession = null;
}

export const clearActiveSafeWalletSession = clearActiveSafeLaceSession;

function walletDescriptor(wallet: Pick<DiscoveredSafeWallet, 'id' | 'name' | 'rdns'>): string {
  return `${wallet.id} ${wallet.name} ${wallet.rdns ?? ''}`.trim().toLowerCase();
}

export function supportedSafeWalletKind(
  wallet: Pick<DiscoveredSafeWallet, 'id' | 'name' | 'rdns'>,
): SupportedSafeWalletKind | null {
  const descriptor = walletDescriptor(wallet);
  const lace = descriptor.includes('lace');
  const oneAm = descriptor.includes('1am');
  if (lace === oneAm) return null;
  return lace ? 'lace' : '1am';
}

function sessionWalletKind(session: SafeLaceSession): SupportedSafeWalletKind | null {
  const detected = supportedSafeWalletKind({
    id: session.connectorId,
    name: session.walletName,
    rdns: session.connectorRdns,
  });
  if (!detected) return null;
  if (session.walletKind && session.walletKind !== detected) return null;
  return detected;
}

export function getInjectedSafeWallets(): DiscoveredSafeWallet[] {
  if (typeof window === 'undefined') return [];
  const candidateWindow = window as unknown as { midnight?: Record<string, any> };
  if (!candidateWindow.midnight || typeof candidateWindow.midnight !== 'object') return [];

  const seenApis = new Set<any>();
  const wallets: DiscoveredSafeWallet[] = [];
  for (const [id, candidate] of Object.entries(candidateWindow.midnight)) {
    if (!candidate || typeof candidate !== 'object' || typeof candidate.connect !== 'function') continue;
    if (seenApis.has(candidate)) continue; // Wallets may expose both UUID entries and stable aliases.
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

function supportedInjectedWallets(preferred?: SupportedSafeWalletKind): Array<{
  wallet: DiscoveredSafeWallet;
  kind: SupportedSafeWalletKind;
}> {
  return getInjectedSafeWallets()
    .map((wallet) => ({ wallet, kind: supportedSafeWalletKind(wallet) }))
    .filter((entry): entry is { wallet: DiscoveredSafeWallet; kind: SupportedSafeWalletKind } => Boolean(entry.kind))
    .filter((entry) => !preferred || entry.kind === preferred);
}

async function waitForSupportedInjectedWallets(preferred?: SupportedSafeWalletKind): Promise<Array<{
  wallet: DiscoveredSafeWallet;
  kind: SupportedSafeWalletKind;
}>> {
  const startedAt = Date.now();
  let firstSeenAt: number | null = null;
  let previousFingerprint = '';

  while (Date.now() - startedAt < WALLET_DETECT_TIMEOUT_MS) {
    const matches = supportedInjectedWallets(preferred);
    const fingerprint = matches
      .map(({ wallet, kind }) => `${kind}:${wallet.id}:${wallet.name}:${wallet.rdns ?? ''}:${wallet.apiVersion ?? ''}`)
      .sort()
      .join('|');

    if (matches.length > 0) {
      if (fingerprint !== previousFingerprint) {
        previousFingerprint = fingerprint;
        firstSeenAt = Date.now();
      }
      if (firstSeenAt !== null && Date.now() - firstSeenAt >= WALLET_REGISTRY_SETTLE_MS) return matches;
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, WALLET_DETECT_INTERVAL_MS));
  }

  return supportedInjectedWallets(preferred);
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
  if (!sessionWalletKind(session)) {
    throw new Error('BLACKOUT_SAFE_UNSUPPORTED_CONNECTOR_REJECTED');
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

/**
 * Returns the wallet's current DUST balance. Lace requires a positive balance.
 * 1AM may use its sponsored Preview execution path, so a valid zero balance is
 * allowed for 1AM; transaction balancing/submission still remains real and may
 * fail closed if sponsorship is unavailable for the requested operation.
 */
export async function requirePreviewDust(session: SafeLaceSession): Promise<bigint> {
  assertPreviewSession(session);
  const dust = readDustBalance(await session.wallet.getDustBalance());
  if (dust <= 0n && sessionWalletKind(session) !== '1am') throw new Error('BLACKOUT_SAFE_ZERO_DUST');
  return dust;
}

/** Re-check mutable wallet state immediately before every LIVE provider build. */
export async function revalidateBlackoutSafeLaceSession(session: SafeLaceSession): Promise<void> {
  assertPreviewSession(session);
  const status = await session.wallet.getConnectionStatus();
  if (status?.status !== 'connected' || status.networkId !== 'preview') {
    throw new Error('BLACKOUT_SAFE_WALLET_SESSION_CHANGED');
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

export const revalidateBlackoutSafeWalletSession = revalidateBlackoutSafeLaceSession;

function walletNotDetectedError(preferred?: SupportedSafeWalletKind): Error {
  if (preferred === 'lace') return new Error('BLACKOUT_SAFE_LACE_NOT_DETECTED');
  if (preferred === '1am') return new Error('BLACKOUT_SAFE_1AM_NOT_DETECTED');
  return new Error('BLACKOUT_SAFE_SUPPORTED_WALLET_NOT_DETECTED');
}

function ambiguousWalletError(preferred?: SupportedSafeWalletKind): Error {
  if (preferred === 'lace') return new Error('BLACKOUT_SAFE_AMBIGUOUS_LACE_CONNECTORS');
  if (preferred === '1am') return new Error('BLACKOUT_SAFE_AMBIGUOUS_1AM_CONNECTORS');
  return new Error('BLACKOUT_SAFE_MULTIPLE_SUPPORTED_WALLETS');
}

/**
 * Connects only to explicitly supported Midnight DApp Connector v4 wallets:
 * Lace and 1AM. No arbitrary injected-wallet fallback and no demo fallback.
 *
 * Browser extensions inject asynchronously, so detection waits up to six
 * seconds and requires the registry to remain stable briefly before selection.
 * With no preference, one supported injected wallet must be present. If both
 * Lace and 1AM are installed the caller must choose explicitly.
 */
export async function connectBlackoutSafeWallet(
  preferred?: SupportedSafeWalletKind,
): Promise<SafeLaceSession> {
  if (typeof window === 'undefined') throw new Error('BLACKOUT_SAFE_BROWSER_REQUIRED');
  const supported = await waitForSupportedInjectedWallets(preferred);

  if (supported.length === 0) throw walletNotDetectedError(preferred);
  if (supported.length > 1) throw ambiguousWalletError(preferred);

  const { wallet: selected, kind } = supported[0];
  const connected = await selected.api.connect('preview');
  const rawConfiguration = await connected.getConfiguration();
  const configuration = normalizedConfiguration(rawConfiguration);
  const connectionStatus = await connected.getConnectionStatus();
  if (connectionStatus?.status !== 'connected' || connectionStatus.networkId !== 'preview') {
    throw new Error('BLACKOUT_SAFE_WALLET_NOT_ON_PREVIEW');
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
    walletKind: kind,
  };
  await revalidateBlackoutSafeLaceSession(session);
  if (activeSession && activeSession !== session) disposeBlackoutSafePrivateStateScope(activeSession);
  activeSession = session;
  return session;
}

/**
 * Backwards-compatible connection entrypoint used by the current web runtime.
 * It now accepts a single installed supported wallet (Lace OR 1AM).
 */
export async function connectBlackoutSafeLace(): Promise<SafeLaceSession> {
  return connectBlackoutSafeWallet();
}

export async function connectBlackoutSafe1AM(): Promise<SafeLaceSession> {
  return connectBlackoutSafeWallet('1am');
}
