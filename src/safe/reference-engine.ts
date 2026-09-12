import {
  computePolicyCommitment,
  computeProposalCommitment,
  computeProposalNullifier,
  deriveMemberCommitment,
  verifyMembershipProof,
} from './crypto.ts';
import type {
  Hex32,
  PrivateMemberMaterial,
  PrivateProposalPayload,
  PublicApprovalReceipt,
  PublicProposalReceipt,
  PublicProposalState,
  PublicSafeState,
  StandardPolicy,
} from './model.ts';

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
  policy: StandardPolicy;
}

export class BlackoutSafeReferenceEngine {
  readonly publicState: PublicSafeState;
  readonly proposals = new Map<Hex32, PublicProposalState>();
  readonly approvalNullifiers = new Set<Hex32>();

  private constructor(state: PublicSafeState) {
    this.publicState = state;
  }

  static async create(input: CreateSafeReferenceInput): Promise<BlackoutSafeReferenceEngine> {
    if (input.policy.threshold < 1) throw new SafeProtocolError('INVALID_THRESHOLD', 'threshold must be positive');
    const policyCommitment = await computePolicyCommitment(input.policy);
    return new BlackoutSafeReferenceEngine({
      safeId: input.safeId,
      membershipRoot: input.membershipRoot,
      membershipVersion: input.policy.membershipVersion,
      policyCommitment,
      policyVersion: input.policy.policyVersion,
      threshold: input.policy.threshold,
      status: 'ACTIVE',
    });
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

  async propose(payload: PrivateProposalPayload, member: PrivateMemberMaterial): Promise<PublicProposalReceipt> {
    if (this.publicState.status !== 'ACTIVE') throw new SafeProtocolError('SAFE_PAUSED', 'safe is paused');
    if (payload.safeId !== this.publicState.safeId) throw new SafeProtocolError('WRONG_SAFE', 'proposal is bound to another Safe');
    await this.requireCurrentMember(member);

    const proposalCommitment = await computeProposalCommitment(payload);
    if (this.proposals.has(proposalCommitment)) {
      throw new SafeProtocolError('DUPLICATE_PROPOSAL', 'proposal commitment already exists');
    }
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
    return {
      safeId: this.publicState.safeId,
      proposalCommitment,
      nullifier,
      membershipVersion: this.publicState.membershipVersion,
      policyVersion: this.publicState.policyVersion,
      approvalCount: proposal.approvalCount,
      quorumSatisfied: proposal.approvalCount >= this.publicState.threshold,
    };
  }

  /** Test-only state transition used to prove stale credentials fail closed. */
  rotateMembershipForReferenceTests(newRoot: Hex32): void {
    this.publicState.membershipRoot = newRoot;
    this.publicState.membershipVersion += 1n;
  }
}
