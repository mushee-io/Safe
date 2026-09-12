import type { ContractAddress, SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';
import type { BlackoutSafePrivateState } from './compiled-safe-contract.ts';

/** Dedicated namespace. Never reuse the income-verifier private-state ID. */
export const BLACKOUT_SAFE_PRIVATE_STATE_ID = 'blackout-safe-session-v1';

type SafePrivateStateProvider = PrivateStateProvider<string, BlackoutSafePrivateState>;

interface ScopedProviderRecord {
  provider: SafePrivateStateProvider;
  dispose(): void;
}

const scopedProviders = new WeakMap<object, ScopedProviderRecord>();

export function createBlackoutSafePrivateStateProvider(): SafePrivateStateProvider {
  const states = new Map<string, BlackoutSafePrivateState>();
  const signingKeys = new Map<string, SigningKey>();
  let contractAddress = '';
  let disposed = false;

  const assertUsable = () => {
    if (disposed) throw new Error('BLACKOUT_SAFE_PRIVATE_STATE_PROVIDER_DISPOSED');
  };
  const scopedKey = (id: string) => `${contractAddress}:${id}`;

  return {
    setContractAddress(address: ContractAddress) {
      assertUsable();
      contractAddress = String(address);
    },
    async get(id) {
      assertUsable();
      const key = scopedKey(id);
      const existing = states.get(key);
      if (existing !== undefined) return existing;
      if (id === BLACKOUT_SAFE_PRIVATE_STATE_ID) {
        const initialState: BlackoutSafePrivateState = {};
        states.set(key, initialState);
        return initialState;
      }
      return null;
    },
    async set(id, state) {
      assertUsable();
      states.set(scopedKey(id), state);
    },
    async remove(id) {
      assertUsable();
      states.delete(scopedKey(id));
    },
    async clear() {
      assertUsable();
      states.clear();
    },
    async setSigningKey(address, signingKey) {
      assertUsable();
      signingKeys.set(String(address), signingKey);
    },
    async getSigningKey(address) {
      assertUsable();
      return signingKeys.get(String(address)) ?? null;
    },
    async removeSigningKey(address) {
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
}

function createScopedRecord(): ScopedProviderRecord {
  const provider = createBlackoutSafePrivateStateProvider();
  let disposed = false;
  return {
    provider,
    dispose() {
      if (disposed) return;
      disposed = true;
      void provider.clear().catch(() => undefined);
      void provider.clearSigningKeys().catch(() => undefined);
    },
  };
}

/**
 * Every connected wallet session receives its own provider instance. This
 * prevents signing-key/private-state references from crossing accounts when a
 * browser switches or reconnects wallets in the same page lifetime.
 */
export function getBlackoutSafePrivateStateProvider(scope: object): SafePrivateStateProvider {
  const existing = scopedProviders.get(scope);
  if (existing) return existing.provider;
  const created = createScopedRecord();
  scopedProviders.set(scope, created);
  return created.provider;
}

export function disposeBlackoutSafePrivateStateScope(scope: object): void {
  const existing = scopedProviders.get(scope);
  if (!existing) return;
  existing.dispose();
  scopedProviders.delete(scope);
}
