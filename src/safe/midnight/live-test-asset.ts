import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import {
  BLACKOUT_TEST_ASSET_PRIVATE_STATE_ID,
  BLACKOUT_TEST_ASSET_ZK_ASSET_PATH,
  makeBlackoutTestAssetCompiledContract,
  type BlackoutTestAssetWitnesses,
} from './compiled-test-asset-contract.ts';
import { buildBlackoutSafeProviders, safeMidnightError } from './providers.ts';
import {
  assertContractAddress,
  finalizedTransactionReference,
  resolvePinnedAssetBaseUrl,
} from './security-hardening.ts';
import { getActiveSafeLaceSession, type SafeLaceSession } from './wallet-session.ts';

export interface BlackoutTestAssetDeployment {
  contractAddress: string;
  txId: string;
  blockHeight: number;
  networkId: 'preview';
}

export interface BlackoutTestAssetMint {
  txId: string;
  blockHeight: number;
  networkId: 'preview';
  coin: {
    nonce: string;
    color: string;
    value: string;
  };
}

function requireSession(session?: SafeLaceSession): SafeLaceSession {
  const active = session ?? getActiveSafeLaceSession();
  if (!active) throw new Error('BLACKOUT_SAFE_WALLET_SESSION_REQUIRED');
  return active;
}

function blockHeight(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('BLACKOUT_TEST_ASSET_INVALID_BLOCK_HEIGHT');
  }
  return parsed;
}

function toHex32(value: unknown, label: string): string {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new Error(`${label}_MUST_BE_32_BYTES`);
  }
  return `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function assetBaseUrl(): string {
  if (typeof window === 'undefined') throw new Error('BLACKOUT_SAFE_BROWSER_REQUIRED');
  return resolvePinnedAssetBaseUrl(BLACKOUT_TEST_ASSET_ZK_ASSET_PATH, window.location.origin);
}

function testAssetWitnesses(): BlackoutTestAssetWitnesses {
  return {
    local_nonce: ({ privateState }: any): [any, Uint8Array] => [
      privateState,
      crypto.getRandomValues(new Uint8Array(32)),
    ],
  } as BlackoutTestAssetWitnesses;
}

export async function deployBlackoutTestAsset(
  session?: SafeLaceSession,
): Promise<BlackoutTestAssetDeployment> {
  const active = requireSession(session);
  try {
    const providers = await buildBlackoutSafeProviders(active, {
      zkAssetPath: BLACKOUT_TEST_ASSET_ZK_ASSET_PATH,
    });
    const compiledContract = makeBlackoutTestAssetCompiledContract(
      testAssetWitnesses(),
      assetBaseUrl(),
    );
    const deployed = await deployContract(providers as any, {
      compiledContract,
      privateStateId: BLACKOUT_TEST_ASSET_PRIVATE_STATE_ID,
      initialPrivateState: {},
      args: [],
    } as any);
    const publicData = deployed.deployTxData.public;
    return {
      contractAddress: assertContractAddress(
        String(publicData.contractAddress),
        'BLACKOUT_TEST_ASSET_INVALID_CONTRACT_ADDRESS',
      ),
      txId: finalizedTransactionReference(publicData, 'BLACKOUT_TEST_ASSET_DEPLOYMENT_TRANSACTION'),
      blockHeight: blockHeight(publicData.blockHeight),
      networkId: 'preview',
    };
  } catch (error) {
    throw new Error(safeMidnightError(error, 'BLACKOUT_TEST_ASSET_PREVIEW_DEPLOY_FAILED'));
  }
}

export async function mintBlackoutTestAsset(
  contractAddress: string,
  amount: bigint,
  session?: SafeLaceSession,
): Promise<BlackoutTestAssetMint> {
  if (amount <= 0n) throw new Error('BLACKOUT_TEST_ASSET_AMOUNT_MUST_BE_POSITIVE');
  if (amount > 1_000_000_000_000n) throw new Error('BLACKOUT_TEST_ASSET_MINT_LIMIT');
  const active = requireSession(session);
  const normalizedAddress = assertContractAddress(
    contractAddress,
    'BLACKOUT_TEST_ASSET_INVALID_CONTRACT_ADDRESS',
  );

  try {
    const providers = await buildBlackoutSafeProviders(active, {
      zkAssetPath: BLACKOUT_TEST_ASSET_ZK_ASSET_PATH,
    });
    const compiledContract = makeBlackoutTestAssetCompiledContract(
      testAssetWitnesses(),
      assetBaseUrl(),
    );
    const result = await submitCallTx(providers as any, {
      compiledContract,
      contractAddress: normalizedAddress,
      circuitId: 'mint_test_asset',
      args: [amount],
      privateStateId: BLACKOUT_TEST_ASSET_PRIVATE_STATE_ID,
    } as any);

    const minted = (result as any)?.private?.result;
    if (!minted || !(minted.nonce instanceof Uint8Array) || !(minted.color instanceof Uint8Array)) {
      throw new Error('BLACKOUT_TEST_ASSET_MINT_RESULT_MISSING');
    }
    const value = BigInt(minted.value);
    if (value !== amount) throw new Error('BLACKOUT_TEST_ASSET_MINT_VALUE_MISMATCH');

    return {
      txId: finalizedTransactionReference(result.public, 'BLACKOUT_TEST_ASSET_MINT_TRANSACTION'),
      blockHeight: blockHeight(result.public.blockHeight),
      networkId: 'preview',
      coin: {
        nonce: toHex32(minted.nonce, 'BLACKOUT_TEST_ASSET_NONCE'),
        color: toHex32(minted.color, 'BLACKOUT_TEST_ASSET_COLOR'),
        value: value.toString(),
      },
    };
  } catch (error) {
    throw new Error(safeMidnightError(error, 'BLACKOUT_TEST_ASSET_MINT_FAILED'));
  }
}
