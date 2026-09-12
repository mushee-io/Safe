export type Hex32 = `0x${string}`;

export type SafeStatus = 'ACTIVE' | 'PAUSED';
export type ProposalStatus = 'PENDING' | 'CANCELLED' | 'EXECUTED';
export type ActionType = 'TRANSFER' | 'PAYROLL' | 'INVOICE' | 'CONTRACT_CALL' | 'GOVERNANCE';

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

export interface StandardPolicy {
  mode: 'STANDARD';
  threshold: number;
  membershipVersion: bigint;
  policyVersion: bigint;
}

/** Public state deliberately excludes raw member commitments and proposal payload. */
export interface PublicSafeState {
  safeId: Hex32;
  membershipRoot: Hex32;
  membershipVersion: bigint;
  policyCommitment: Hex32;
  policyVersion: bigint;
  threshold: number;
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
  quorumSatisfied: boolean;
}

export interface PublicProposalReceipt {
  safeId: Hex32;
  proposalCommitment: Hex32;
  membershipVersion: bigint;
  policyVersion: bigint;
  status: 'PENDING';
}
