import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { Contract, type Witnesses } from '../../../contract/build-safe/contract/index.js';

/**
 * Safe private state is intentionally empty. Member secrets, Merkle paths,
 * private proposals, policy openings and held coins are supplied ephemerally
 * through Compact witness callbacks and are never persisted here.
 */
export type BlackoutSafePrivateState = Record<string, never>;
export type BlackoutSafeWitnesses = Witnesses<BlackoutSafePrivateState>;

export const BLACKOUT_SAFE_CONTRACT_NAME = 'BlackoutSafe';
export const BLACKOUT_SAFE_ZK_ASSET_PATH = '/zk-artifacts/blackout-safe';

export function makeBlackoutSafeCompiledContract(
  witnesses: BlackoutSafeWitnesses,
  assetBaseUrl = BLACKOUT_SAFE_ZK_ASSET_PATH,
) {
  return CompiledContract.make(BLACKOUT_SAFE_CONTRACT_NAME, Contract).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(assetBaseUrl),
  );
}
