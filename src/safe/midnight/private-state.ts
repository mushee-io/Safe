import type { ContractAddress, SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';
import type { BlackoutSafePrivateState } from './compiled-safe-contract.ts';

/** Dedicated namespace. Never reuse the income-verifier private-state ID. */
export const BLACKOUT_SAFE_PRIVATE_STATE_ID = 'blackout-safe-session-v1';

export function createBlackoutSafePrivateStateProvider(): PrivateStateProvider<string, BlackoutSafePrivateState> {
  const states = new Map<string, BlackoutSafePrivateState>();
  const signingKeys = new Map<string, SigningKey>();
  let contractAddress = '';
  const scopedKey = (id: string) => `${contractAddress}:${id}`;

  return {
    setContractAddress(address: ContractAddress) {
      contractAddress = String(address);
    },
    async get(id) {
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
      states.set(scopedKey(id), state);
    },
    async remove(id) {
      states.delete(scopedKey(id));
    },
    async clear() {
      states.clear();
    },
    async setSigningKey(address, signingKey) {
      signingKeys.set(String(address), signingKey);
    },
    async getSigningKey(address) {
      return signingKeys.get(String(address)) ?? null;
    },
    async removeSigningKey(address) {
      signingKeys.delete(String(address));
    },
    async clearSigningKeys() {
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
  } as PrivateStateProvider<string, BlackoutSafePrivateState>;
}

/** Shared provider preserves contract-scoped state across deploy/call lifecycle. */
export const blackoutSafePrivateStateProvider = createBlackoutSafePrivateStateProvider();
