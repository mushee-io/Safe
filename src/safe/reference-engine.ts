import {
  computeExecutionNullifier,
  computePolicyCommitment,
  computeProposalCommitment,
  computeProposalNonceNullifier,
  computeProposalNullifier,
  deriveMemberCommitment,
  verifyMembershipProof,
} from './crypto.ts';
import {
  assertPolicyOpening,
  evaluateExecutionPolicy,
  evaluateProposalPolicy,
} from './policy-engine.ts';
import type {
  Hex32,
  PrivateMemberMaterial,
  PrivateProposalPayload,
  PublicApprovalReceipt,
  PublicExecutionReceipt,
  PublicProposalReceipt,
  PublicProposalState,
  PublicQuorumReceipt,
  PublicSafeState,
  TreasuryPolicy,
} from './model.ts';
import type { ShieldedTreasuryAdapter } from './treasury.ts';

export class SafeProtocolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'SafeProtocolError';
  }
}

export interface CreateSafeReferenceInput {
  safeId: Hex32;
  membershipRoot: Hex32;
  policy: TreasuryPolicy;
}

export interface ExecuteReferenceInput {
  proposalCommitment: Hex32;
  payload: PrivateProposalPayload;
  nowSeconds: bigint;
  treasury: ShieldedTreasuryAdapter;
  /** Optional explicit opening used to prove a private policy commitment. */
  policyOpening?: TreasuryPolicy;
}

export class BlackoutSafeReferenceEngine {
  readonly publicState: PublicSafeState;
  readonly proposals = new Map<Hex32, PublicProposalState>();
  readonly approvalNullifiers = new Set<Hex32>();
  readonly executionNullifiers = new Set<Hex32>();
  readonly proposalNonceNullifiers = new Set<Hex32>();

  /** Local/private policy material. Never part of publicSafeState. */
  private activePolicy: TreasuryPolicy;

  private constructor(state: PublicSafeState, policy: TreasuryPolicy) {
    this.publicState = state;
    this.activePolicy = policy;
  }

  static async create(input: CreateSafeReferenceInput): Promise<BlackoutSafeReferenceEngine> {
    const policyCommitment = await computePolicyCommitment(input.policy);
    return new BlackoutSafeReferenceEngine(
      {
        safeId: input.safeId,
        membershipRoot: input.membershipRoot,
        membershipVersion: input.policy.membershipVersion,
        policyCommitment,
        policyVersion: input.policy.policyVersion,
        policyMode: input.policy.mode,
        threshold: input.policy.mode === 'STANDARD' ? input.policy.threshold : null,
        status: 'ACTIVE',
      },
      { ...input.policy },
    );
  }

  private async requireCurrentMember(member: PrivateMemberMaterial): Promise<void> {
    if (member.membershipVersion !== this.publicState.membershipVersion) {
      throw new SafeProtocolError('STALE_MEMBERSHIP', 'membership material is bound to a stale membership version');
    }
    const derived = await deriveMemberCommitment(member.memberSecret);
    if (derived !== member.memberCommitment) {
      throw new SafeProtocolError('MEMBER_SECRET_MISMATCH', 'member secret does not open the claimed member commitment');
    }
    const valid = await verifyMembershipProof(
      member.memberCommitment,
      member.membershipProof,
      this.publicState.membershipRoot,
    );
    if (!valid) throw new SafeProtocolError('NOT_AUTHORIZED', 'membership proof does not match the active membership root');
  }

  private async resolvePolicy(opening?: TreasuryPolicy): Promise<TreasuryPolicy> {
    const candidate = opening ?? this.activePolicy;
    if (candidate.membershipVersion !== this.publicState.membershipVersion) {
      throw new SafeProtocolError('STALE_POLICY_MEMBERSHIP', 'policy opening is bound to another membership version');
    }
    if (candidate.policyVersion !== this.publicState.policyVersion) {
      throw new SafeProtocolError('STALE_POLICY', 'policy opening is bound to another policy version');
    }
    if (candidate.mode !== this.publicState.policyMode) {
      throw new SafeProtocolError('POLICY_MODE_MISMATCH', 'policy opening uses the wrong privacy mode');
    }
    try {
      await assertPolicyOpening(candidate, this.publicState.policyCommitment);
    } catch (error) {
      throw new SafeProtocolError(
        'POLICY_COMMITMENT_MISMATCH',
        error instanceof Error ? error.message : 'policy commitment mismatch',
      );
    }
    if (this.publicState.policyMode === 'STANDARD' && candidate.threshold !== this.publicState.threshold) {
      throw new SafeProtocolError('PUBLIC_THRESHOLD_MISMATCH', 'standard policy threshold does not match public state');
    }
    return candidate;
  }

  async propose(payload: PrivateProposalPayload, member: PrivateMemberMaterial): Promise<PublicProposalReceipt> {
    if (this.publicState.status !== 'ACTIVE') throw new SafeProtocolError('SAFE_PAUSED', 'safe is paused');
    if (payload.safeId !== this.publicState.safeId) throw new SafeProtocolError('WRONG_SAFE', 'proposal is bound to another Safe');
    if (payload.amount <= 0n) throw new SafeProtocolError('INVALID_AMOUNT', 'proposal amount must be positive');
    await this.requireCurrentMember(member);
    const policy = await this.resolvePolicy();
    const policyResult = evaluateProposalPolicy(policy, payload);
    if (!policyResult.checks.amountWithinLimit) {
      throw new SafeProtocolError('POLICY_AMOUNT_LIMIT', 'proposal amount exceeds active treasury policy');
    }
    if (!policyResult.checks.lifetimeWithinLimit) {
      throw new SafeProtocolError('POLICY_LIFETIME_LIMIT', 'proposal lifetime exceeds active treasury policy');
    }

    const proposalCommitment = await computeProposalCommitment(payload);
    if (this.proposals.has(proposalCommitment)) {
      throw new SafeProtocolError('DUPLICATE_PROPOSAL', 'proposal commitment already exists');
    }
    const nonceNullifier = await computeProposalNonceNullifier(this.publicState.safeId, payload.nonce);
    if (this.proposalNonceNullifiers.has(nonceNullifier)) {
      throw new SafeProtocolError('DUPLICATE_PROPOSAL_NONCE', 'proposal nonce was already used by this Safe');
    }

    this.proposalNonceNullifiers.add(nonceNullifier);
    this.proposals.set(proposalCommitment, {
      proposalCommitment,
      membershipVersion: this.publicState.membershipVersion,
      policyVersion: this.publicState.policyVersion,
      approvalCount: 0,
      status: 'PENDING',
    });
    return {
      safeId: this.publicState.safeId,
      proposalCommitment,
      membershipVersion: this.publicState.membershipVersion,
      policyVersion: this.publicState.policyVersion,
      status: 'PENDING',
    };
  }

  async approve(proposalCommitment: Hex32, member: PrivateMemberMaterial): Promise<PublicApprovalReceipt> {
    if (this.publicState.status !== 'ACTIVE') throw new SafeProtocolError('SAFE_PAUSED', 'safe is paused');
    const proposal = this.proposals.get(proposalCommitment);
    if (!proposal) throw new SafeProtocolError('UNKNOWN_PROPOSAL', 'proposal does not exist');
    if (proposal.status !== 'PENDING') throw new SafeProtocolError('PROPOSAL_NOT_PENDING', 'proposal cannot accept approvals');
    if (proposal.membershipVersion !== this.publicState.membershipVersion) {
      throw new SafeProtocolError('PROPOSAL_STALE_MEMBERSHIP', 'proposal was created under another membership version');
    }
    if (proposal.policyVersion !== this.publicState.policyVersion) {
      throw new SafeProtocolError('PROPOSAL_STALE_POLICY', 'proposal was created under another policy version');
    }

    await this.requireCurrentMember(member);
    const nullifier = await computeProposalNullifier(this.publicState.safeId, proposalCommitment, member.memberSecret);
    if (this.approvalNullifiers.has(nullifier)) {
      throw new SafeProtocolError('DUPLICATE_APPROVAL', 'this member already approved this proposal');
    }

    this.approvalNullifiers.add(nullifier);
    proposal.approvalCount += 1;
    const policy = await this.resolvePolicy();
    return {
      safeId: this.publicState.safeId,
      proposalCommitment,
      nullifier,
      membershipVersion: this.publicState.membershipVersion,
      policyVersion: this.publicState.policyVersion,
      approvalCount: proposal.approvalCount,
      quorumSatisfied:
        this.publicState.policyMode === 'STANDARD'
          ? proposal.approvalCount >= policy.threshold
          : null,
    };
  }

  async proveQuorum(proposalCommitment: Hex32, policyOpening?: TreasuryPolicy): Promise<PublicQuorumReceipt> {
    const proposal = this.proposals.get(proposalCommitment);
    if (!proposal) throw new SafeProtocolError('UNKNOWN_PROPOSAL', 'proposal does not exist');
    if (proposal.status !== 'PENDING') throw new SafeProtocolError('PROPOSAL_NOT_PENDING', 'proposal is no longer pending');
    const policy = await this.resolvePolicy(policyOpening);
    if (proposal.approvalCount < policy.threshold) {
      throw new SafeProtocolError('QUORUM_NOT_REACHED', 'valid unique approvals do not satisfy the active policy');
    }
    return {
      safeId: this.publicState.safeId,
      proposalCommitment,
      membershipVersion: proposal.membershipVersion,
      policyVersion: proposal.policyVersion,
      statement: 'QUORUM_AUTHORIZED',
      valid: true,
    };
  }

  async execute(input: ExecuteReferenceInput): Promise<PublicExecutionReceipt> {
    if (this.publicState.status !== 'ACTIVE') throw new SafeProtocolError('SAFE_PAUSED', 'safe is paused');
    const proposal = this.proposals.get(input.proposalCommitment);
    if (!proposal) throw new SafeProtocolError('UNKNOWN_PROPOSAL', 'proposal does not exist');
    if (proposal.status !== 'PENDING') throw new SafeProtocolError('PROPOSAL_NOT_PENDING', 'proposal cannot be executed');
    if (proposal.membershipVersion !== this.publicState.membershipVersion) {
      throw new SafeProtocolError('PROPOSAL_STALE_MEMBERSHIP', 'proposal was created under another membership version');
    }
    if (proposal.policyVersion !== this.publicState.policyVersion) {
      throw new SafeProtocolError('PROPOSAL_STALE_POLICY', 'proposal was created under another policy version');
    }
    if (input.payload.safeId !== this.publicState.safeId) {
      throw new SafeProtocolError('WRONG_SAFE', 'execution payload is bound to another Safe');
    }
    if (input.payload.actionType !== 'TRANSFER') {
      throw new SafeProtocolError('UNSUPPORTED_EXECUTION_ACTION', 'Milestone 10 execution currently supports shielded TRANSFER only');
    }

    const recomputedCommitment = await computeProposalCommitment(input.payload);
    if (recomputedCommitment !== input.proposalCommitment) {
      throw new SafeProtocolError('PROPOSAL_COMMITMENT_MISMATCH', 'execution payload does not match approved proposal commitment');
    }

    const policy = await this.resolvePolicy(input.policyOpening);
    const evaluation = evaluateExecutionPolicy(policy, input.payload, proposal.approvalCount, input.nowSeconds);
    if (!evaluation.checks.amountWithinLimit) throw new SafeProtocolError('POLICY_AMOUNT_LIMIT', 'transfer exceeds policy amount limit');
    if (!evaluation.checks.lifetimeWithinLimit) throw new SafeProtocolError('POLICY_LIFETIME_LIMIT', 'proposal exceeds policy lifetime');
    if (!evaluation.checks.executionDelaySatisfied) throw new SafeProtocolError('EXECUTION_DELAY', 'mandatory execution delay has not elapsed');
    if (!evaluation.checks.notExpired) throw new SafeProtocolError('PROPOSAL_EXPIRED', 'proposal has expired');
    if (!evaluation.checks.quorumSatisfied) throw new SafeProtocolError('QUORUM_NOT_REACHED', 'valid unique approvals do not satisfy the active policy');

    const executionNullifier = await computeExecutionNullifier(
      this.publicState.safeId,
      input.proposalCommitment,
      input.payload.nonce,
    );
    if (this.executionNullifiers.has(executionNullifier)) {
      throw new SafeProtocolError('EXECUTION_REPLAY', 'proposal execution nullifier was already consumed');
    }

    const spendable = await input.treasury.getSpendableBalance(input.payload.asset);
    if (spendable < input.payload.amount) {
      throw new SafeProtocolError('INSUFFICIENT_FUNDS', 'shielded treasury balance is insufficient');
    }

    // External treasury transfer must succeed before public execution state mutates.
    const transfer = await input.treasury.executeShieldedTransfer({
      safeId: this.publicState.safeId,
      proposalCommitment: input.proposalCommitment,
      tokenType: input.payload.asset,
      recipientCoinPublicKey: input.payload.recipient,
      amount: input.payload.amount,
    });

    this.executionNullifiers.add(executionNullifier);
    proposal.status = 'EXECUTED';

    return {
      safeId: this.publicState.safeId,
      proposalCommitment: input.proposalCommitment,
      executionNullifier,
      membershipVersion: proposal.membershipVersion,
      policyVersion: proposal.policyVersion,
      status: 'EXECUTED',
      statement: 'POLICY_COMPLIANT_QUORUM_EXECUTION',
      policyCompliant: true,
      quorumSatisfied: true,
      treasuryTransferId: transfer.transferId,
    };
  }

  /** Test-only state transition used to prove stale credentials fail closed. */
  async rotateMembershipForReferenceTests(newRoot: Hex32): Promise<void> {
    this.publicState.membershipRoot = newRoot;
    this.publicState.membershipVersion += 1n;
    this.activePolicy = { ...this.activePolicy, membershipVersion: this.publicState.membershipVersion } as TreasuryPolicy;
    this.publicState.policyCommitment = await computePolicyCommitment(this.activePolicy);
  }

  /** Test-only policy rotation. Production governance must authorize this through a proposal. */
  async rotatePolicyForReferenceTests(policy: TreasuryPolicy): Promise<void> {
    this.activePolicy = { ...policy };
    this.publicState.policyCommitment = await computePolicyCommitment(policy);
    this.publicState.policyVersion = policy.policyVersion;
    this.publicState.policyMode = policy.mode;
    this.publicState.threshold = policy.mode === 'STANDARD' ? policy.threshold : null;
  }
}
