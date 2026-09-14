import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { Contract, type Witnesses } from '../../../contract/build-test-asset/contract/index.js';

export type BlackoutTestAssetPrivateState = Record<string, never>;
export type BlackoutTestAssetWitnesses = Witnesses<BlackoutTestAssetPrivateState>;

export const BLACKOUT_TEST_ASSET_CONTRACT_NAME = 'BlackoutSafeTestAsset';
export const BLACKOUT_TEST_ASSET_ZK_ASSET_PATH = '/zk-artifacts/blackout-test-asset';
export const BLACKOUT_TEST_ASSET_PRIVATE_STATE_ID = 'blackout-safe-test-asset-v1';

export function makeBlackoutTestAssetCompiledContract(
  witnesses: BlackoutTestAssetWitnesses,
  assetBaseUrl = BLACKOUT_TEST_ASSET_ZK_ASSET_PATH,
) {
  return CompiledContract.make(BLACKOUT_TEST_ASSET_CONTRACT_NAME, Contract).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(assetBaseUrl),
  );
}
