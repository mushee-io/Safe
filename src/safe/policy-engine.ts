import { computePolicyCommitment } from './crypto.ts';
import type { PrivateProposalPayload, PolicyEvaluation, TreasuryPolicy } from './model.ts';

export class PolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'PolicyError';
  }
}

export function assertPolicyConfiguration(policy: TreasuryPolicy): void {
  if (!Number.isInteger(policy.threshold) || policy.threshold < 1 || policy.threshold > 65_535) {
    throw new PolicyError('INVALID_THRESHOLD', 'threshold must be an integer between 1 and 65535');
  }
  if (policy.membershipVersion < 1n || policy.policyVersion < 1n) {
    throw new PolicyError('INVALID_POLICY_VERSION', 'membership and policy versions must be positive');
  }
  if (policy.maxTransferAmount !== undefined && policy.maxTransferAmount <= 0n) {
    throw new PolicyError('INVALID_MAX_TRANSFER', 'max transfer amount must be positive when configured');
  }
  if (policy.maxProposalLifetimeSeconds !== undefined && policy.maxProposalLifetimeSeconds <= 0n) {
    throw new PolicyError('INVALID_MAX_LIFETIME', 'max proposal lifetime must be positive when configured');
  }
  if ((policy.minExecutionDelaySeconds ?? 0n) < 0n) {
    throw new PolicyError('INVALID_MIN_DELAY', 'minimum execution delay cannot be negative');
  }
}

export async function assertPolicyOpening(policy: TreasuryPolicy, expectedCommitment: string): Promise<void> {
  assertPolicyConfiguration(policy);
  const actual = await computePolicyCommitment(policy);
  if (actual !== expectedCommitment) {
    throw new PolicyError('POLICY_COMMITMENT_MISMATCH', 'private policy witness does not open the active policy commitment');
  }
}

export function evaluateProposalPolicy(policy: TreasuryPolicy, payload: PrivateProposalPayload): PolicyEvaluation {
  assertPolicyConfiguration(policy);
  const lifetime = payload.expiresAt - payload.createdAt;
  const amountWithinLimit = policy.maxTransferAmount === undefined || payload.amount <= policy.maxTransferAmount;
  const lifetimeWithinLimit =
    policy.maxProposalLifetimeSeconds === undefined || lifetime <= policy.maxProposalLifetimeSeconds;

  return {
    compliant: amountWithinLimit && lifetimeWithinLimit,
    checks: {
      amountWithinLimit,
      lifetimeWithinLimit,
      executionDelaySatisfied: true,
      notExpired: true,
      quorumSatisfied: false,
    },
  };
}

export function evaluateExecutionPolicy(
  policy: TreasuryPolicy,
  payload: PrivateProposalPayload,
  approvalCount: number,
  nowSeconds: bigint,
): PolicyEvaluation {
  const proposal = evaluateProposalPolicy(policy, payload);
  const minDelay = policy.minExecutionDelaySeconds ?? 0n;
  const executionDelaySatisfied = nowSeconds >= payload.createdAt + minDelay;
  const notExpired = nowSeconds < payload.expiresAt;
  const quorumSatisfied = approvalCount >= policy.threshold;
  const compliant =
    proposal.compliant && executionDelaySatisfied && notExpired && quorumSatisfied;

  return {
    compliant,
    checks: {
      ...proposal.checks,
      executionDelaySatisfied,
      notExpired,
      quorumSatisfied,
    },
  };
}
