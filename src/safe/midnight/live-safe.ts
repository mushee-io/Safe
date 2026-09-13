import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import {
  BLACKOUT_SAFE_ZK_ASSET_PATH,
  makeBlackoutSafeCompiledContract,
  type BlackoutSafeWitnesses,
} from './compiled-safe-contract.ts';
import { BLACKOUT_SAFE_PRIVATE_STATE_ID } from './private-state.ts';
import { buildBlackoutSafeProviders, safeMidnightError } from './providers.ts';
import {
  assertCircuitArity,
  assertContractAddress,
  assertTransactionId,
  resolvePinnedAssetBaseUrl,
} from './security-hardening.ts';
import { getActiveSafeLaceSession, type SafeLaceSession } from './wallet-session.ts';

export type BlackoutSafeCircuitId =
  | 'propose_private'
  | 'approve_private'
  | 'prove_quorum'
  | 'deposit_shielded'
  | 'execute_shielded_transfer'
  | 'governance_pause'
  | 'governance_resume'
  | 'governance_cancel_proposal'
  | 'governance_rotate_membership'
  | 'governance_change_policy'
  | 'receipt_statement';

const CIRCUIT_ARITY: Readonly<Record<BlackoutSafeCircuitId, number>> = {
  propose_private: 1,
  approve_private: 1,
  prove_quorum: 1,
  deposit_shielded: 1,
  execute_shielded_transfer: 1,
  governance_pause: 1,
  governance_resume: 1,
  governance_cancel_proposal: 2,
  governance_rotate_membership: 2,
  governance_change_policy: 1,
  receipt_statement: 4,
};

export interface DeployBlackoutSafeInput {
  session?: SafeLaceSession;
  safeId: Uint8Array;
  membershipRoot: unknown;
  policyCommitment: Uint8Array;
  policyIsPrivate: boolean;
  standardRequiredQuorum: bigint;
  /** Constructor does not consume private witnesses, but the compiled wrapper requires callbacks. */
  witnesses?: BlackoutSafeWitnesses;
}

export interface SubmitBlackoutSafeCallInput {
  session?: SafeLaceSession;
  contractAddress: string;
  circuitId: BlackoutSafeCircuitId;
  args: readonly unknown[];
  witnesses: BlackoutSafeWitnesses;
}

const unavailable = () => {
  throw new Error('BLACKOUT_SAFE_PRIVATE_WITNESS_REQUIRED');
};

export function unavailableBlackoutSafeWitnesses(): BlackoutSafeWitnesses {
  return {
    local_member_secret: unavailable,
    local_member_path: unavailable,
    local_private_proposal: unavailable,
    local_policy: unavailable,
    local_next_policy: unavailable,
    held_coin: unavailable,
  } as unknown as BlackoutSafeWitnesses;
}

function require32(label: string, value: Uint8Array): void {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new Error(`${label}_MUST_BE_32_BYTES`);
  }
}

function requireSession(session?: SafeLaceSession): SafeLaceSession {
  const active = session ?? getActiveSafeLaceSession();
  if (!active) throw new Error('BLACKOUT_SAFE_LACE_SESSION_REQUIRED');
  return active;
}

function safeBlockHeight(value: unknown): number {
  const blockHeight = Number(value);
  if (!Number.isSafeInteger(blockHeight) || blockHeight < 0) {
    throw new Error('BLACKOUT_SAFE_INVALID_BLOCK_HEIGHT');
  }
  return blockHeight;
}

function pinnedAssetBaseUrl(): string {
  if (typeof window === 'undefined') throw new Error('BLACKOUT_SAFE_BROWSER_REQUIRED');
  return resolvePinnedAssetBaseUrl(BLACKOUT_SAFE_ZK_ASSET_PATH, window.location.origin);
}

export async function deployBlackoutSafe(input: DeployBlackoutSafeInput) {
  require32('BLACKOUT_SAFE_SAFE_ID', input.safeId);
  require32('BLACKOUT_SAFE_POLICY_COMMITMENT', input.policyCommitment);
  if (input.standardRequiredQuorum < 0n) throw new Error('BLACKOUT_SAFE_INVALID_STANDARD_QUORUM');
  if (input.policyIsPrivate && input.standardRequiredQuorum !== 0n) {
    throw new Error('BLACKOUT_SAFE_PRIVATE_POLICY_THRESHOLD_MUST_BE_ZERO');
  }
  if (!input.policyIsPrivate && input.standardRequiredQuorum <= 0n) {
    throw new Error('BLACKOUT_SAFE_STANDARD_QUORUM_REQUIRED');
  }

  const session = requireSession(input.session);
  try {
    const assetBaseUrl = pinnedAssetBaseUrl();
    const providers = await buildBlackoutSafeProviders(session);
    const compiledContract = makeBlackoutSafeCompiledContract(
      input.witnesses ?? unavailableBlackoutSafeWitnesses(),
      assetBaseUrl,
    );
    const deployed = await deployContract(providers as any, {
      compiledContract,
      privateStateId: BLACKOUT_SAFE_PRIVATE_STATE_ID,
      initialPrivateState: {},
      args: [
        input.safeId,
        input.membershipRoot,
        input.policyCommitment,
        input.policyIsPrivate,
        input.standardRequiredQuorum,
      ],
    } as any);

    return {
      contractAddress: assertContractAddress(
        String(deployed.deployTxData.public.contractAddress),
        'BLACKOUT_SAFE_INVALID_CONTRACT_ADDRESS',
      ),
      txId: assertTransactionId(
        String(deployed.deployTxData.public.txId),
        'BLACKOUT_SAFE_INVALID_DEPLOYMENT_TX_ID',
      ),
      blockHeight: safeBlockHeight(deployed.deployTxData.public.blockHeight),
      networkId: 'preview' as const,
    };
  } catch (error) {
    throw new Error(safeMidnightError(error, 'BLACKOUT_SAFE_PREVIEW_DEPLOY_FAILED'));
  }
}

export async function submitBlackoutSafeCall(input: SubmitBlackoutSafeCallInput) {
  const contractAddress = assertContractAddress(input.contractAddress, 'BLACKOUT_SAFE_INVALID_CONTRACT_ADDRESS');
  assertCircuitArity(input.circuitId, input.args, CIRCUIT_ARITY);
  const session = requireSession(input.session);
  try {
    const assetBaseUrl = pinnedAssetBaseUrl();
    const providers = await buildBlackoutSafeProviders(session);
    const compiledContract = makeBlackoutSafeCompiledContract(input.witnesses, assetBaseUrl);
    const result = await submitCallTx(providers as any, {
      compiledContract,
      contractAddress,
      circuitId: input.circuitId,
      args: [...input.args],
      privateStateId: BLACKOUT_SAFE_PRIVATE_STATE_ID,
    } as any);

    return {
      txId: assertTransactionId(String(result.public.txId), 'BLACKOUT_SAFE_INVALID_CALL_TX_ID'),
      blockHeight: safeBlockHeight(result.public.blockHeight),
      circuitId: input.circuitId,
      networkId: 'preview' as const,
    };
  } catch (error) {
    throw new Error(safeMidnightError(error, `BLACKOUT_SAFE_${input.circuitId.toUpperCase()}_FAILED`));
  }
}
