export type Hex32 = `0x${string}`;

export type SafeStatus = 'ACTIVE' | 'PAUSED';
export type ProposalStatus = 'PENDING' | 'CANCELLED' | 'EXECUTED' | 'EXECUTION_UNCERTAIN';
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

/**
 * Public proposal state deliberately excludes the proposal category/action.
 * TREASURY vs GOVERNANCE remains private metadata bound inside the commitment.
 * policyCommitment snapshots only the already-public policy commitment so
 * historical receipts can still bind to the proposal's original policy.
 */
export interface PublicProposalState {
  proposalCommitment: Hex32;
  membershipVersion: bigint;
  policyVersion: bigint;
  policyCommitment: Hex32;
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

export type RecipientDiscoveryMode =
  | 'WALLET_NATIVE'
  | 'EXECUTOR_ASSISTED'
  | 'OUT_OF_BAND_REQUIRED'
  | 'NONE';

export interface ShieldedTreasuryCapabilities {
  mode: 'LIVE' | 'REFERENCE' | 'UNAVAILABLE';
  supportsShieldedCustody: boolean;
  supportsShieldedSpend: boolean;
  recipientDiscovery: RecipientDiscoveryMode;
  returnsNetworkTransactionId: boolean;
}

export interface ShieldedTransferResult {
  /** Adapter-level transfer reference. It is NOT necessarily a network transaction id. */
  transferId: Hex32;
  kind: 'SHIELDED';
  mode: 'LIVE' | 'REFERENCE';
  /** Must be null unless returned by a real Midnight submission path. */
  networkTransactionId: Hex32 | null;
  recipientDiscovery: RecipientDiscoveryMode;
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
  networkTransactionId: Hex32 | null;
  recipientDiscovery: RecipientDiscoveryMode;
}

export type GovernanceOperation =
  | { action: 'ROTATE_MEMBERSHIP'; newMembershipRoot: Hex32 }
  | { action: 'CHANGE_POLICY'; newPolicy: TreasuryPolicy }
  | { action: 'PAUSE' }
  | { action: 'RESUME' }
  | { action: 'CANCEL_PROPOSAL'; targetProposalCommitment: Hex32 };

export interface PublicGovernanceReceipt {
  safeId: Hex32;
  proposalCommitment: Hex32;
  governanceAction: GovernanceOperation['action'];
  membershipVersion: bigint;
  policyVersion: bigint;
  policyCommitment: Hex32;
  membershipRoot: Hex32;
  safeStatus: SafeStatus;
  status: 'EXECUTED';
  cancelledProposalCommitment?: Hex32;
}

export type BlackoutReceiptStatementType =
  | 'QUORUM_AUTHORIZED'
  | 'POLICY_COMPLIANT_EXECUTION'
  | 'EXECUTED_EXACTLY_ONCE'
  | 'MEMBERSHIP_ROTATED'
  | 'POLICY_CHANGED'
  | 'SAFE_PAUSED'
  | 'SAFE_RESUMED'
  | 'PROPOSAL_CANCELLED';

export interface BlackoutReceiptDisclosures {
  amount?: bigint;
  recipient?: Hex32;
  executedAt?: bigint;
  proposalType?: ActionType;
}

export interface BlackoutReceiptPublicInputs {
  proposalCommitment?: Hex32;
  executionNullifier?: Hex32;
  membershipRoot?: Hex32;
  policyCommitment?: Hex32;
  safeStatus?: SafeStatus;
  cancelledProposalCommitment?: Hex32;
}

export interface BlackoutReceiptEnvelope {
  protocol: 'blackout-safe';
  version: 1;
  proofSystem: 'REFERENCE_ONLY' | 'MIDNIGHT';
  safeId: Hex32;
  statementType: BlackoutReceiptStatementType;
  statementCommitment: Hex32;
  membershipVersion: bigint;
  policyVersion: bigint;
  publicInputs: BlackoutReceiptPublicInputs;
  disclosures: BlackoutReceiptDisclosures;
  /** Null in reference-only mode. LIVE verification must reject null proofs. */
  proof: string | null;
}

export interface ReceiptVerificationResult {
  valid: boolean;
  cryptographicallyVerified: boolean;
  code:
    | 'MIDNIGHT_PROOF_VERIFIED'
    | 'REFERENCE_INTEGRITY_ONLY'
    | 'REFERENCE_PROOF_NOT_ACCEPTED'
    | 'RECEIPT_INTEGRITY_MISMATCH'
    | 'MISSING_MIDNIGHT_PROOF'
    | 'MIDNIGHT_VERIFIER_UNAVAILABLE'
    | 'MIDNIGHT_PROOF_INVALID';
}
