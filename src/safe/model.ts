export type Hex32 = `0x${string}`;

export type SafeStatus = 'ACTIVE' | 'PAUSED';
export type ProposalStatus = 'PENDING' | 'CANCELLED' | 'EXECUTED';
export type ActionType = 'TRANSFER' | 'PAYROLL' | 'INVOICE' | 'CONTRACT_CALL' | 'GOVERNANCE';
export type PolicyMode = 'STANDARD' | 'PRIVATE_POLICY';

/**
 * Private proposal payload. This object must never be written to public ledger
 * state or emitted to public analytics/logging. Only its commitment belongs in
 * public protocol state.
 */
export interface PrivateProposalPayload {
  safeId: Hex32;
  actionType: ActionType;
  asset: Hex32;
  recipient: Hex32;
  amount: bigint;
  calldataOrAction: Hex32;
  memoHash: Hex32;
  createdAt: bigint;
  expiresAt: bigint;
  nonce: Hex32;
  salt: Hex32;
}

export interface PolicyRules {
  threshold: number;
  /** undefined means no per-transfer ceiling in this policy version. */
  maxTransferAmount?: bigint;
  /** undefined means the policy does not cap proposal lifetime. */
  maxProposalLifetimeSeconds?: bigint;
  /** Defaults to zero. */
  minExecutionDelaySeconds?: bigint;
}

export interface StandardPolicy extends PolicyRules {
  mode: 'STANDARD';
  membershipVersion: bigint;
  policyVersion: bigint;
  /** Optional salt; zero is used by default because STANDARD intentionally exposes threshold. */
  policySalt?: Hex32;
}

export interface PrivatePolicy extends PolicyRules {
  mode: 'PRIVATE_POLICY';
  membershipVersion: bigint;
  policyVersion: bigint;
  /** Required so low-entropy policy values cannot be trivially dictionary-hashed. */
  policySalt: Hex32;
}

export type TreasuryPolicy = StandardPolicy | PrivatePolicy;

/** Public state deliberately excludes raw member commitments and private policy rules. */
export interface PublicSafeState {
  safeId: Hex32;
  membershipRoot: Hex32;
  membershipVersion: bigint;
  policyCommitment: Hex32;
  policyVersion: bigint;
  policyMode: PolicyMode;
  /** Explicitly public only in STANDARD mode. */
  threshold: number | null;
  status: SafeStatus;
}

export interface PublicProposalState {
  proposalCommitment: Hex32;
  membershipVersion: bigint;
  policyVersion: bigint;
  approvalCount: number;
  status: ProposalStatus;
}

export interface MerkleProof {
  leafIndex: number;
  siblings: Hex32[];
  /** true means the sibling is on the left side of the current node. */
  siblingOnLeft: boolean[];
}

export interface PrivateMemberMaterial {
  memberSecret: Hex32;
  memberCommitment: Hex32;
  membershipProof: MerkleProof;
  membershipVersion: bigint;
}

export interface PublicApprovalReceipt {
  safeId: Hex32;
  proposalCommitment: Hex32;
  nullifier: Hex32;
  membershipVersion: bigint;
  policyVersion: bigint;
  approvalCount: number;
  /** PRIVATE_POLICY does not publish threshold/quorum progression per approval. */
  quorumSatisfied: boolean | null;
}

export interface PublicProposalReceipt {
  safeId: Hex32;
  proposalCommitment: Hex32;
  membershipVersion: bigint;
  policyVersion: bigint;
  status: 'PENDING';
}

export interface PolicyEvaluation {
  compliant: boolean;
  checks: {
    amountWithinLimit: boolean;
    lifetimeWithinLimit: boolean;
    executionDelaySatisfied: boolean;
    notExpired: boolean;
    quorumSatisfied: boolean;
  };
}

export interface PublicQuorumReceipt {
  safeId: Hex32;
  proposalCommitment: Hex32;
  membershipVersion: bigint;
  policyVersion: bigint;
  statement: 'QUORUM_AUTHORIZED';
  valid: true;
}

export interface ShieldedTransferRequest {
  safeId: Hex32;
  proposalCommitment: Hex32;
  tokenType: Hex32;
  recipientCoinPublicKey: Hex32;
  amount: bigint;
}

export interface ShieldedTransferResult {
  transferId: Hex32;
  kind: 'SHIELDED';
}

export interface PublicExecutionReceipt {
  safeId: Hex32;
  proposalCommitment: Hex32;
  executionNullifier: Hex32;
  membershipVersion: bigint;
  policyVersion: bigint;
  status: 'EXECUTED';
  statement: 'POLICY_COMPLIANT_QUORUM_EXECUTION';
  policyCompliant: true;
  quorumSatisfied: true;
  treasuryTransferId: Hex32;
}
