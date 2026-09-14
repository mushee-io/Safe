import type { ContractAddress, SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';
import type { BlackoutSafePrivateState } from './compiled-safe-contract.ts';

/** Dedicated namespaces. Never reuse the income-verifier private-state ID. */
export const BLACKOUT_SAFE_PRIVATE_STATE_ID = 'blackout-safe-session-v1';
export const BLACKOUT_TEST_ASSET_PRIVATE_STATE_ID = 'blackout-safe-test-asset-v1';

const EMPTY_PRIVATE_STATE_IDS = new Set([
  BLACKOUT_SAFE_PRIVATE_STATE_ID,
  BLACKOUT_TEST_ASSET_PRIVATE_STATE_ID,
]);

type SafePrivateStateProvider = PrivateStateProvider<string, BlackoutSafePrivateState>;

interface ScopedProviderRecord {
  provider: SafePrivateStateProvider;
  dispose(): void;
}

const scopedProviders = new WeakMap<object, ScopedProviderRecord>();

function buildProviderRecord(): ScopedProviderRecord {
  const states = new Map<string, BlackoutSafePrivateState>();
  const signingKeys = new Map<string, SigningKey>();
  let contractAddress = '';
  let disposed = false;

  const assertUsable = () => {
    if (disposed) throw new Error('BLACKOUT_SAFE_PRIVATE_STATE_PROVIDER_DISPOSED');
  };
  const scopedKey = (id: string) => `${contractAddress}:${id}`;

  const provider = {
    setContractAddress(address: ContractAddress) {
      assertUsable();
      contractAddress = String(address);
    },
    async get(id: string) {
      assertUsable();
      const key = scopedKey(id);
      const existing = states.get(key);
      if (existing !== undefined) return existing;
      if (EMPTY_PRIVATE_STATE_IDS.has(id)) {
        const initialState: BlackoutSafePrivateState = {};
        states.set(key, initialState);
        return initialState;
      }
      return null;
    },
    async set(id: string, state: BlackoutSafePrivateState) {
      assertUsable();
      states.set(scopedKey(id), state);
    },
    async remove(id: string) {
      assertUsable();
      states.delete(scopedKey(id));
    },
    async clear() {
      assertUsable();
      states.clear();
    },
    async setSigningKey(address: ContractAddress, signingKey: SigningKey) {
      assertUsable();
      signingKeys.set(String(address), signingKey);
    },
    async getSigningKey(address: ContractAddress) {
      assertUsable();
      return signingKeys.get(String(address)) ?? null;
    },
    async removeSigningKey(address: ContractAddress) {
      assertUsable();
      signingKeys.delete(String(address));
    },
    async clearSigningKeys() {
      assertUsable();
      signingKeys.clear();
    },
    async exportPrivateStates() {
      throw new Error('BLACKOUT_SAFE_PRIVATE_STATE_EXPORT_DISABLED');
    },
    async importPrivateStates() {
      throw new Error('BLACKOUT_SAFE_PRIVATE_STATE_IMPORT_DISABLED');
    },
    async exportSigningKeys() {
      throw new Error('BLACKOUT_SAFE_SIGNING_KEY_EXPORT_DISABLED');
    },
    async importSigningKeys() {
      throw new Error('BLACKOUT_SAFE_SIGNING_KEY_IMPORT_DISABLED');
    },
  } as SafePrivateStateProvider;

  return {
    provider,
    dispose() {
      if (disposed) return;
      states.clear();
      signingKeys.clear();
      contractAddress = '';
      disposed = true;
    },
  };
}

export function createBlackoutSafePrivateStateProvider(): SafePrivateStateProvider {
  return buildProviderRecord().provider;
}

/**
 * Every connected wallet session receives its own provider instance. This
 * prevents signing-key/private-state references from crossing accounts when a
 * browser switches or reconnects wallets in the same page lifetime.
 */
export function getBlackoutSafePrivateStateProvider(scope: object): SafePrivateStateProvider {
  const existing = scopedProviders.get(scope);
  if (existing) return existing.provider;
  const created = buildProviderRecord();
  scopedProviders.set(scope, created);
  return created.provider;
}

export function disposeBlackoutSafePrivateStateScope(scope: object): void {
  const existing = scopedProviders.get(scope);
  if (!existing) return;
  existing.dispose();
  scopedProviders.delete(scope);
}
