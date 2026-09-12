import type { BlackoutSafePrivateState, BlackoutSafeWitnesses } from './compiled-safe-contract.ts';

type MemberSecret = ReturnType<BlackoutSafeWitnesses['local_member_secret']>[1];
type MemberCommitment = Parameters<BlackoutSafeWitnesses['local_member_path']>[1];
type MemberPath = ReturnType<BlackoutSafeWitnesses['local_member_path']>[1];
type PrivateProposal = ReturnType<BlackoutSafeWitnesses['local_private_proposal']>[1];
type PrivatePolicy = ReturnType<BlackoutSafeWitnesses['local_policy']>[1];
type CoinColor = Parameters<BlackoutSafeWitnesses['held_coin']>[1];
type HeldCoin = ReturnType<BlackoutSafeWitnesses['held_coin']>[1];

export interface BlackoutSafeEphemeralWitnessBundle {
  memberSecret?: MemberSecret;
  memberPath?: MemberPath | ((memberCommitment: MemberCommitment) => MemberPath);
  privateProposal?: PrivateProposal;
  policy?: PrivatePolicy;
  nextPolicy?: PrivatePolicy;
  heldCoin?: HeldCoin | ((color: CoinColor) => HeldCoin);
}

function required<T>(name: string, value: T | undefined): T {
  if (value === undefined) throw new Error(`BLACKOUT_SAFE_WITNESS_${name}_MISSING`);
  return value;
}

function resolve<TArg, TResult>(
  name: string,
  source: TResult | ((arg: TArg) => TResult) | undefined,
  arg: TArg,
): TResult {
  const value = required(name, source);
  return typeof value === 'function'
    ? (value as (item: TArg) => TResult)(arg)
    : value;
}

/**
 * Build the exact compiler-generated Compact witness interface from an
 * ephemeral in-memory bundle. Witness values are returned to the circuit and
 * are never copied into persistent Safe private state, browser storage or logs.
 */
export function buildBlackoutSafeWitnesses(
  bundle: BlackoutSafeEphemeralWitnessBundle,
): BlackoutSafeWitnesses {
  const witnesses: BlackoutSafeWitnesses = {
    local_member_secret: (context) => [
      context.privateState,
      required('MEMBER_SECRET', bundle.memberSecret),
    ],
    local_member_path: (context, memberCommitment) => [
      context.privateState,
      resolve('MEMBER_PATH', bundle.memberPath, memberCommitment),
    ],
    local_private_proposal: (context) => [
      context.privateState,
      required('PRIVATE_PROPOSAL', bundle.privateProposal),
    ],
    local_policy: (context) => [
      context.privateState,
      required('POLICY', bundle.policy),
    ],
    local_next_policy: (context) => [
      context.privateState,
      required('NEXT_POLICY', bundle.nextPolicy),
    ],
    held_coin: (context, color) => [
      context.privateState,
      resolve('HELD_COIN', bundle.heldCoin, color),
    ],
  };
  return witnesses;
}

/** Compile-time assertion that the private-state type remains empty. */
export function emptyBlackoutSafePrivateState(): BlackoutSafePrivateState {
  return {};
}
