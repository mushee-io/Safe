import {
  computeExecutionNullifier,
  computePolicyCommitment,
  computeProposalCommitment,
  computeProposalNonceNullifier,
  computeProposalNullifier,
  deriveMemberCommitment,
  verifyMembershipProof,
} from './crypto.ts';
import { computeGovernanceOperationCommitment } from './governance.ts';
import {
  assertPolicyOpening,
  evaluateExecutionPolicy,
  evaluateProposalPolicy,
} from './policy-engine.ts';
import type {
  GovernanceOperation,
  Hex32,
  PrivateMemberMaterial,
  PrivateProposalPayload,
  PublicApprovalReceipt,
  PublicExecutionReceipt,
  PublicGovernanceReceipt,
  PublicProposalReceipt,
  PublicProposalState,
  PublicQuorumReceipt,
  PublicSafeState,
  TreasuryPolicy,
} from './model.ts';
import { getTreasuryCapabilities, type ShieldedTreasuryAdapter } from './treasury.ts';

const MAX_UINT64 = 18_446_744_073_709_551_615n;
type PrivateProposalKind = 'TREASURY' | 'GOVERNANCE';

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
  policyOpening?: TreasuryPolicy;
}

export interface ExecuteGovernanceReferenceInput {
  proposalCommitment: Hex32;
  payload: PrivateProposalPayload;
  operation: GovernanceOperation;
  nowSeconds: bigint;
  policyOpening?: TreasuryPolicy;
}

export class BlackoutSafeReferenceEngine {
  #state: PublicSafeState;
  #proposals = new Map<Hex32, PublicProposalState>();
  #proposalKinds = new Map<Hex32, PrivateProposalKind>();
  #approvalNullifiers = new Set<Hex32>();
  #executionNullifiers = new Set<Hex32>();
  #proposalNonceNullifiers = new Set<Hex32>();
  #activePolicy: TreasuryPolicy;

  private constructor(state: PublicSafeState, policy: TreasuryPolicy) {
    this.#state = state;
    this.#activePolicy = policy;
  }

  get publicState(): Readonly<PublicSafeState> {
    return { ...this.#state };
  }

  get proposals(): ReadonlyMap<Hex32, PublicProposalState> {
    return new Map(Array.from(this.#proposals.entries(), ([key, value]) => [key, { ...value }]));
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
    if (member.membershipVersion !== this.#state.membershipVersion) {
      throw new SafeProtocolError('STALE_MEMBERSHIP', 'membership material is bound to a stale membership version');
    }
    const derived = await deriveMemberCommitment(member.memberSecret);
    if (derived !== member.memberCommitment) {
      throw new SafeProtocolError('MEMBER_SECRET_MISMATCH', 'member secret does not open the claimed member commitment');
    }
    const valid = await verifyMembershipProof(member.memberCommitment, member.membershipProof, this.#state.membershipRoot);
    if (!valid) throw new SafeProtocolError('NOT_AUTHORIZED', 'membership proof does not match the active membership root');
  }

  private async resolvePolicy(opening?: TreasuryPolicy): Promise<TreasuryPolicy> {
    const candidate = opening ?? this.#activePolicy;
    if (candidate.membershipVersion !== this.#state.membershipVersion) {
      throw new SafeProtocolError('STALE_POLICY_MEMBERSHIP', 'policy opening is bound to another membership version');
    }
    if (candidate.policyVersion !== this.#state.policyVersion) {
      throw new SafeProtocolError('STALE_POLICY', 'policy opening is bound to another policy version');
    }
    if (candidate.mode !== this.#state.policyMode) {
      throw new SafeProtocolError('POLICY_MODE_MISMATCH', 'policy opening uses the wrong privacy mode');
    }
    try {
      await assertPolicyOpening(candidate, this.#state.policyCommitment);
    } catch (error) {
      throw new SafeProtocolError('POLICY_COMMITMENT_MISMATCH', error instanceof Error ? error.message : 'policy commitment mismatch');
    }
    if (this.#state.policyMode === 'STANDARD' && candidate.threshold !== this.#state.threshold) {
      throw new SafeProtocolError('PUBLIC_THRESHOLD_MISMATCH', 'standard policy threshold does not match public state');
    }
    return candidate;
  }

  private requireProposalCurrent(proposal: PublicProposalState): void {
    if (proposal.membershipVersion !== this.#state.membershipVersion) {
      throw new SafeProtocolError('PROPOSAL_STALE_MEMBERSHIP', 'proposal was created under another membership version');
    }
    if (proposal.policyVersion !== this.#state.policyVersion) {
      throw new SafeProtocolError('PROPOSAL_STALE_POLICY', 'proposal was created under another policy version');
    }
  }

  private proposalKind(proposalCommitment: Hex32): PrivateProposalKind {
    const kind = this.#proposalKinds.get(proposalCommitment);
    if (!kind) {
      throw new SafeProtocolError('PRIVATE_PROPOSAL_METADATA_MISSING', 'private proposal category is unavailable');
    }
    return kind;
  }

  async propose(payload: PrivateProposalPayload, member: PrivateMemberMaterial): Promise<PublicProposalReceipt> {
    const kind: PrivateProposalKind = payload.actionType === 'GOVERNANCE' ? 'GOVERNANCE' : 'TREASURY';
    if (this.#state.status !== 'ACTIVE' && kind !== 'GOVERNANCE') {
      throw new SafeProtocolError('SAFE_PAUSED', 'safe is paused for treasury actions');
    }
    if (payload.safeId !== this.#state.safeId) throw new SafeProtocolError('WRONG_SAFE', 'proposal is bound to another Safe');
    if (kind === 'TREASURY' && payload.amount <= 0n) {
      throw new SafeProtocolError('INVALID_AMOUNT', 'treasury proposal amount must be positive');
    }
    if (kind === 'GOVERNANCE' && payload.amount !== 0n) {
      throw new SafeProtocolError('GOVERNANCE_AMOUNT_NONZERO', 'governance proposals must not encode treasury value in amount');
    }

    await this.requireCurrentMember(member);
    const policy = await this.resolvePolicy();
    const policyResult = evaluateProposalPolicy(policy, payload);
    if (kind === 'TREASURY' && !policyResult.checks.amountWithinLimit) {
      throw new SafeProtocolError('POLICY_AMOUNT_LIMIT', 'proposal amount exceeds active treasury policy');
    }
    if (!policyResult.checks.lifetimeWithinLimit) {
      throw new SafeProtocolError('POLICY_LIFETIME_LIMIT', 'proposal lifetime exceeds active treasury policy');
    }

    const proposalCommitment = await computeProposalCommitment(payload);
    if (this.#proposals.has(proposalCommitment)) {
      throw new SafeProtocolError('DUPLICATE_PROPOSAL', 'proposal commitment already exists');
    }
    const nonceNullifier = await computeProposalNonceNullifier(this.#state.safeId, payload.nonce);
    if (this.#proposalNonceNullifiers.has(nonceNullifier)) {
      throw new SafeProtocolError('DUPLICATE_PROPOSAL_NONCE', 'proposal nonce was already used by this Safe');
    }

    this.#proposalNonceNullifiers.add(nonceNullifier);
    this.#proposalKinds.set(proposalCommitment, kind);
    this.#proposals.set(proposalCommitment, {
      proposalCommitment,
      membershipVersion: this.#state.membershipVersion,
      policyVersion: this.#state.policyVersion,
      approvalCount: 0,
      status: 'PENDING',
    });
    return {
      safeId: this.#state.safeId,
      proposalCommitment,
      membershipVersion: this.#state.membershipVersion,
      policyVersion: this.#state.policyVersion,
      status: 'PENDING',
    };
  }

  async approve(proposalCommitment: Hex32, member: PrivateMemberMaterial): Promise<PublicApprovalReceipt> {
    const proposal = this.#proposals.get(proposalCommitment);
    if (!proposal) throw new SafeProtocolError('UNKNOWN_PROPOSAL', 'proposal does not exist');
    if (proposal.status !== 'PENDING') throw new SafeProtocolError('PROPOSAL_NOT_PENDING', 'proposal cannot accept approvals');
    const kind = this.proposalKind(proposalCommitment);
    if (this.#state.status !== 'ACTIVE' && kind !== 'GOVERNANCE') {
      throw new SafeProtocolError('SAFE_PAUSED', 'safe is paused for treasury actions');
    }
    this.requireProposalCurrent(proposal);

    await this.requireCurrentMember(member);
    const nullifier = await computeProposalNullifier(this.#state.safeId, proposalCommitment, member.memberSecret);
    if (this.#approvalNullifiers.has(nullifier)) {
      throw new SafeProtocolError('DUPLICATE_APPROVAL', 'this member already approved this proposal');
    }
    if (proposal.approvalCount >= Number.MAX_SAFE_INTEGER) {
      throw new SafeProtocolError('APPROVAL_COUNT_OVERFLOW', 'approval count exceeded the reference-model safe integer range');
    }

    this.#approvalNullifiers.add(nullifier);
    proposal.approvalCount += 1;
    const policy = await this.resolvePolicy();
    return {
      safeId: this.#state.safeId,
      proposalCommitment,
      nullifier,
      membershipVersion: this.#state.membershipVersion,
      policyVersion: this.#state.policyVersion,
      approvalCount: proposal.approvalCount,
      quorumSatisfied: this.#state.policyMode === 'STANDARD' ? proposal.approvalCount >= policy.threshold : null,
    };
  }

  async proveQuorum(proposalCommitment: Hex32, policyOpening?: TreasuryPolicy): Promise<PublicQuorumReceipt> {
    const proposal = this.#proposals.get(proposalCommitment);
    if (!proposal) throw new SafeProtocolError('UNKNOWN_PROPOSAL', 'proposal does not exist');
    if (proposal.status !== 'PENDING') throw new SafeProtocolError('PROPOSAL_NOT_PENDING', 'proposal is no longer pending');
    this.requireProposalCurrent(proposal);
    const policy = await this.resolvePolicy(policyOpening);
    if (proposal.approvalCount < policy.threshold) {
      throw new SafeProtocolError('QUORUM_NOT_REACHED', 'valid unique approvals do not satisfy the active policy');
    }
    return {
      safeId: this.#state.safeId,
      proposalCommitment,
      membershipVersion: proposal.membershipVersion,
      policyVersion: proposal.policyVersion,
      statement: 'QUORUM_AUTHORIZED',
      valid: true,
    };
  }

  async execute(input: ExecuteReferenceInput): Promise<PublicExecutionReceipt> {
    if (this.#state.status !== 'ACTIVE') throw new SafeProtocolError('SAFE_PAUSED', 'safe is paused');
    const proposal = this.#proposals.get(input.proposalCommitment);
    if (!proposal) throw new SafeProtocolError('UNKNOWN_PROPOSAL', 'proposal does not exist');
    if (proposal.status !== 'PENDING') throw new SafeProtocolError('PROPOSAL_NOT_PENDING', 'proposal cannot be executed');
    if (this.proposalKind(input.proposalCommitment) !== 'TREASURY') {
      throw new SafeProtocolError('GOVERNANCE_REQUIRES_GOVERNANCE_EXECUTION', 'governance proposal must use executeGovernance');
    }
    this.requireProposalCurrent(proposal);
    if (input.payload.safeId !== this.#state.safeId) throw new SafeProtocolError('WRONG_SAFE', 'execution payload is bound to another Safe');
    if (input.payload.actionType !== 'TRANSFER') {
      throw new SafeProtocolError('UNSUPPORTED_EXECUTION_ACTION', 'shielded execution currently supports TRANSFER only');
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

    const executionNullifier = await computeExecutionNullifier(this.#state.safeId, input.proposalCommitment, input.payload.nonce);
    if (this.#executionNullifiers.has(executionNullifier)) {
      throw new SafeProtocolError('EXECUTION_REPLAY', 'proposal execution nullifier was already consumed');
    }

    const capabilities = await getTreasuryCapabilities(input.treasury);
    if (!capabilities.supportsShieldedCustody || !capabilities.supportsShieldedSpend) {
      throw new SafeProtocolError('TREASURY_UNAVAILABLE', 'No real Midnight shielded treasury adapter is configured.');
    }
    if (capabilities.mode === 'LIVE' && !capabilities.returnsNetworkTransactionId) {
      throw new SafeProtocolError('LIVE_TREASURY_TX_ID_UNSUPPORTED', 'LIVE treasury adapter cannot prove the submitted Midnight transaction identifier.');
    }

    const spendable = await input.treasury.getSpendableBalance(input.payload.asset);
    if (spendable < input.payload.amount) {
      throw new SafeProtocolError('INSUFFICIENT_FUNDS', 'shielded treasury balance is insufficient');
    }

    const transfer = await input.treasury.executeShieldedTransfer({
      safeId: this.#state.safeId,
      proposalCommitment: input.proposalCommitment,
      tokenType: input.payload.asset,
      recipientCoinPublicKey: input.payload.recipient,
      amount: input.payload.amount,
    });

    if (capabilities.mode === 'LIVE' && transfer.networkTransactionId === null) {
      proposal.status = 'EXECUTION_UNCERTAIN';
      throw new SafeProtocolError('LIVE_TRANSFER_OUTCOME_UNCERTAIN', 'LIVE transfer returned without a Midnight transaction identifier; proposal locked against retry');
    }

    this.#executionNullifiers.add(executionNullifier);
    proposal.status = 'EXECUTED';
    this.#proposalKinds.delete(input.proposalCommitment);

    return {
      safeId: this.#state.safeId,
      proposalCommitment: input.proposalCommitment,
      executionNullifier,
      membershipVersion: proposal.membershipVersion,
      policyVersion: proposal.policyVersion,
      status: 'EXECUTED',
      statement: 'POLICY_COMPLIANT_QUORUM_EXECUTION',
      policyCompliant: true,
      quorumSatisfied: true,
      treasuryTransferId: transfer.transferId,
      networkTransactionId: transfer.networkTransactionId,
      recipientDiscovery: transfer.recipientDiscovery,
    };
  }

  async executeGovernance(input: ExecuteGovernanceReferenceInput): Promise<PublicGovernanceReceipt> {
    const proposal = this.#proposals.get(input.proposalCommitment);
    if (!proposal) throw new SafeProtocolError('UNKNOWN_PROPOSAL', 'proposal does not exist');
    if (proposal.status !== 'PENDING') throw new SafeProtocolError('PROPOSAL_NOT_PENDING', 'governance proposal cannot be executed');
    if (this.proposalKind(input.proposalCommitment) !== 'GOVERNANCE') {
      throw new SafeProtocolError('NOT_GOVERNANCE_PROPOSAL', 'treasury proposal cannot execute governance');
    }
    this.requireProposalCurrent(proposal);
    if (input.payload.safeId !== this.#state.safeId || input.payload.actionType !== 'GOVERNANCE') {
      throw new SafeProtocolError('INVALID_GOVERNANCE_PAYLOAD', 'governance payload is not bound to this Safe');
    }
    if (input.payload.amount !== 0n) {
      throw new SafeProtocolError('GOVERNANCE_AMOUNT_NONZERO', 'governance execution cannot transfer treasury value');
    }

    const recomputedProposal = await computeProposalCommitment(input.payload);
    if (recomputedProposal !== input.proposalCommitment) {
      throw new SafeProtocolError('PROPOSAL_COMMITMENT_MISMATCH', 'governance payload does not match approved proposal commitment');
    }
    const operationCommitment = await computeGovernanceOperationCommitment(input.operation);
    if (operationCommitment !== input.payload.calldataOrAction) {
      throw new SafeProtocolError('GOVERNANCE_OPERATION_MISMATCH', 'governance operation does not match committed action');
    }

    const policy = await this.resolvePolicy(input.policyOpening);
    const evaluation = evaluateExecutionPolicy(policy, input.payload, proposal.approvalCount, input.nowSeconds);
    if (!evaluation.checks.lifetimeWithinLimit) throw new SafeProtocolError('POLICY_LIFETIME_LIMIT', 'governance proposal exceeds policy lifetime');
    if (!evaluation.checks.executionDelaySatisfied) throw new SafeProtocolError('EXECUTION_DELAY', 'mandatory governance delay has not elapsed');
    if (!evaluation.checks.notExpired) throw new SafeProtocolError('PROPOSAL_EXPIRED', 'governance proposal has expired');
    if (!evaluation.checks.quorumSatisfied) throw new SafeProtocolError('QUORUM_NOT_REACHED', 'governance quorum is not satisfied');

    const executionNullifier = await computeExecutionNullifier(this.#state.safeId, input.proposalCommitment, input.payload.nonce);
    if (this.#executionNullifiers.has(executionNullifier)) {
      throw new SafeProtocolError('EXECUTION_REPLAY', 'governance execution nullifier was already consumed');
    }

    let cancelledProposalCommitment: Hex32 | undefined;

    if (input.operation.action === 'ROTATE_MEMBERSHIP') {
      if (input.operation.newMembershipRoot === this.#state.membershipRoot) {
        throw new SafeProtocolError('MEMBERSHIP_ROOT_UNCHANGED', 'membership rotation must change the active root');
      }
      if (this.#state.membershipVersion >= MAX_UINT64) {
        throw new SafeProtocolError('MEMBERSHIP_VERSION_OVERFLOW', 'membership version cannot exceed Uint64');
      }
      const nextVersion = this.#state.membershipVersion + 1n;
      const nextPolicy = { ...this.#activePolicy, membershipVersion: nextVersion } as TreasuryPolicy;
      const nextPolicyCommitment = await computePolicyCommitment(nextPolicy);
      this.#state.membershipRoot = input.operation.newMembershipRoot;
      this.#state.membershipVersion = nextVersion;
      this.#activePolicy = nextPolicy;
      this.#state.policyCommitment = nextPolicyCommitment;
    } else if (input.operation.action === 'CHANGE_POLICY') {
      if (input.operation.newPolicy.membershipVersion !== this.#state.membershipVersion) {
        throw new SafeProtocolError('NEW_POLICY_MEMBERSHIP_MISMATCH', 'new policy must bind the current membership version');
      }
      if (this.#state.policyVersion >= MAX_UINT64) {
        throw new SafeProtocolError('POLICY_VERSION_OVERFLOW', 'policy version cannot exceed Uint64');
      }
      if (input.operation.newPolicy.policyVersion !== this.#state.policyVersion + 1n) {
        throw new SafeProtocolError('NEW_POLICY_VERSION_INVALID', 'new policy version must increment exactly once');
      }
      const nextPolicyCommitment = await computePolicyCommitment(input.operation.newPolicy);
      this.#activePolicy = { ...input.operation.newPolicy };
      this.#state.policyCommitment = nextPolicyCommitment;
      this.#state.policyVersion = input.operation.newPolicy.policyVersion;
      this.#state.policyMode = input.operation.newPolicy.mode;
      this.#state.threshold = input.operation.newPolicy.mode === 'STANDARD' ? input.operation.newPolicy.threshold : null;
    } else if (input.operation.action === 'PAUSE') {
      if (this.#state.status === 'PAUSED') throw new SafeProtocolError('SAFE_ALREADY_PAUSED', 'safe is already paused');
      this.#state.status = 'PAUSED';
    } else if (input.operation.action === 'RESUME') {
      if (this.#state.status !== 'PAUSED') throw new SafeProtocolError('SAFE_NOT_PAUSED', 'safe is not paused');
      this.#state.status = 'ACTIVE';
    } else if (input.operation.action === 'CANCEL_PROPOSAL') {
      if (input.operation.targetProposalCommitment === input.proposalCommitment) {
        throw new SafeProtocolError('GOVERNANCE_SELF_CANCEL', 'governance proposal cannot cancel itself during execution');
      }
      const target = this.#proposals.get(input.operation.targetProposalCommitment);
      if (!target) throw new SafeProtocolError('CANCEL_TARGET_UNKNOWN', 'cancel target does not exist');
      if (target.status !== 'PENDING') throw new SafeProtocolError('CANCEL_TARGET_NOT_PENDING', 'only pending proposals can be cancelled');
      target.status = 'CANCELLED';
      this.#proposalKinds.delete(input.operation.targetProposalCommitment);
      cancelledProposalCommitment = input.operation.targetProposalCommitment;
    }

    this.#executionNullifiers.add(executionNullifier);
    proposal.status = 'EXECUTED';
    this.#proposalKinds.delete(input.proposalCommitment);

    return {
      safeId: this.#state.safeId,
      proposalCommitment: input.proposalCommitment,
      governanceAction: input.operation.action,
      membershipVersion: this.#state.membershipVersion,
      policyVersion: this.#state.policyVersion,
      policyCommitment: this.#state.policyCommitment,
      membershipRoot: this.#state.membershipRoot,
      safeStatus: this.#state.status,
      status: 'EXECUTED',
      ...(cancelledProposalCommitment ? { cancelledProposalCommitment } : {}),
    };
  }

  async rotateMembershipForReferenceTests(newRoot: Hex32): Promise<void> {
    if (this.#state.membershipVersion >= MAX_UINT64) {
      throw new SafeProtocolError('MEMBERSHIP_VERSION_OVERFLOW', 'membership version cannot exceed Uint64');
    }
    this.#state.membershipRoot = newRoot;
    this.#state.membershipVersion += 1n;
    this.#activePolicy = { ...this.#activePolicy, membershipVersion: this.#state.membershipVersion } as TreasuryPolicy;
    this.#state.policyCommitment = await computePolicyCommitment(this.#activePolicy);
  }

  async rotatePolicyForReferenceTests(policy: TreasuryPolicy): Promise<void> {
    this.#activePolicy = { ...policy };
    this.#state.policyCommitment = await computePolicyCommitment(policy);
    this.#state.policyVersion = policy.policyVersion;
    this.#state.policyMode = policy.mode;
    this.#state.threshold = policy.mode === 'STANDARD' ? policy.threshold : null;
  }
}
