import { domainHash } from './crypto.ts';
import type {
  ActionType,
  BlackoutReceiptDisclosures,
  BlackoutReceiptEnvelope,
  BlackoutReceiptPublicInputs,
  BlackoutReceiptStatementType,
  Hex32,
  PublicExecutionReceipt,
  PublicGovernanceReceipt,
  PublicQuorumReceipt,
  PublicSafeState,
  ReceiptVerificationResult,
} from './model.ts';

export class ReceiptError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ReceiptError';
  }
}

const STATEMENT_TYPES = new Set<BlackoutReceiptStatementType>([
  'QUORUM_AUTHORIZED',
  'POLICY_COMPLIANT_EXECUTION',
  'EXECUTED_EXACTLY_ONCE',
  'MEMBERSHIP_ROTATED',
  'POLICY_CHANGED',
  'SAFE_PAUSED',
  'SAFE_RESUMED',
  'PROPOSAL_CANCELLED',
]);
const ACTION_TYPES = new Set<ActionType>(['TRANSFER', 'PAYROLL', 'INVOICE', 'CONTRACT_CALL', 'GOVERNANCE']);

function isHex32(value: unknown): value is Hex32 {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
}

function assertOptionalHex32(value: unknown, label: string): void {
  if (value !== undefined && !isHex32(value)) {
    throw new ReceiptError('MALFORMED_RECEIPT', `${label} must be a 32-byte hex value`);
  }
}

function assertReceiptShape(receipt: BlackoutReceiptEnvelope): void {
  if (!receipt || typeof receipt !== 'object') {
    throw new ReceiptError('MALFORMED_RECEIPT', 'receipt must be an object');
  }
  if (receipt.protocol !== 'blackout-safe' || receipt.version !== 1) {
    throw new ReceiptError('UNSUPPORTED_RECEIPT', 'unsupported Blackout Safe receipt format');
  }
  if (receipt.proofSystem !== 'REFERENCE_ONLY' && receipt.proofSystem !== 'MIDNIGHT') {
    throw new ReceiptError('MALFORMED_RECEIPT', 'unsupported receipt proof system');
  }
  if (!isHex32(receipt.safeId) || !isHex32(receipt.statementCommitment)) {
    throw new ReceiptError('MALFORMED_RECEIPT', 'receipt identifiers must be 32-byte hex values');
  }
  if (typeof receipt.membershipVersion !== 'bigint' || receipt.membershipVersion <= 0n) {
    throw new ReceiptError('MALFORMED_RECEIPT', 'membership version must be a positive bigint');
  }
  if (typeof receipt.policyVersion !== 'bigint' || receipt.policyVersion <= 0n) {
    throw new ReceiptError('MALFORMED_RECEIPT', 'policy version must be a positive bigint');
  }
  if (!STATEMENT_TYPES.has(receipt.statementType)) {
    throw new ReceiptError('MALFORMED_RECEIPT', 'unknown receipt statement type');
  }
  if (!receipt.publicInputs || typeof receipt.publicInputs !== 'object') {
    throw new ReceiptError('MALFORMED_RECEIPT', 'receipt public inputs are required');
  }
  if (!receipt.disclosures || typeof receipt.disclosures !== 'object') {
    throw new ReceiptError('MALFORMED_RECEIPT', 'receipt disclosures are required');
  }

  assertOptionalHex32(receipt.publicInputs.proposalCommitment, 'proposal commitment');
  assertOptionalHex32(receipt.publicInputs.executionNullifier, 'execution nullifier');
  assertOptionalHex32(receipt.publicInputs.membershipRoot, 'membership root');
  assertOptionalHex32(receipt.publicInputs.policyCommitment, 'policy commitment');
  assertOptionalHex32(receipt.publicInputs.cancelledProposalCommitment, 'cancelled proposal commitment');
  if (
    receipt.publicInputs.safeStatus !== undefined &&
    receipt.publicInputs.safeStatus !== 'ACTIVE' &&
    receipt.publicInputs.safeStatus !== 'PAUSED'
  ) {
    throw new ReceiptError('MALFORMED_RECEIPT', 'invalid Safe status');
  }

  if (receipt.disclosures.amount !== undefined && (typeof receipt.disclosures.amount !== 'bigint' || receipt.disclosures.amount < 0n)) {
    throw new ReceiptError('MALFORMED_RECEIPT', 'disclosed amount must be a non-negative bigint');
  }
  assertOptionalHex32(receipt.disclosures.recipient, 'disclosed recipient');
  if (receipt.disclosures.executedAt !== undefined && (typeof receipt.disclosures.executedAt !== 'bigint' || receipt.disclosures.executedAt < 0n)) {
    throw new ReceiptError('MALFORMED_RECEIPT', 'execution time must be a non-negative bigint');
  }
  if (receipt.disclosures.proposalType !== undefined && !ACTION_TYPES.has(receipt.disclosures.proposalType)) {
    throw new ReceiptError('MALFORMED_RECEIPT', 'invalid disclosed proposal type');
  }

  if (receipt.proofSystem === 'REFERENCE_ONLY' && receipt.proof !== null) {
    throw new ReceiptError('MALFORMED_RECEIPT', 'reference receipts must not carry a purported cryptographic proof');
  }
  if (receipt.proofSystem === 'MIDNIGHT' && receipt.proof !== null && (typeof receipt.proof !== 'string' || receipt.proof.length === 0)) {
    throw new ReceiptError('MALFORMED_RECEIPT', 'Midnight proof must be a non-empty string when present');
  }

  if (receipt.statementType === 'QUORUM_AUTHORIZED' && !receipt.publicInputs.proposalCommitment) {
    throw new ReceiptError('MALFORMED_RECEIPT', 'quorum receipt requires proposal commitment');
  }
  if (
    receipt.statementType === 'EXECUTED_EXACTLY_ONCE' &&
    (!receipt.publicInputs.proposalCommitment || !receipt.publicInputs.executionNullifier)
  ) {
    throw new ReceiptError('MALFORMED_RECEIPT', 'execution receipt requires proposal commitment and execution nullifier');
  }
  if (receipt.statementType === 'PROPOSAL_CANCELLED' && !receipt.publicInputs.cancelledProposalCommitment) {
    throw new ReceiptError('MALFORMED_RECEIPT', 'cancellation receipt requires cancelled proposal commitment');
  }
}

function field(value: string | bigint | undefined): string {
  return value === undefined ? 'UNSET' : String(value);
}

export async function computeReceiptStatementCommitment(input: {
  safeId: Hex32;
  statementType: BlackoutReceiptStatementType;
  membershipVersion: bigint;
  policyVersion: bigint;
  publicInputs: BlackoutReceiptPublicInputs;
  disclosures: BlackoutReceiptDisclosures;
}): Promise<Hex32> {
  return domainHash(
    'blackout:safe:receipt:v1',
    input.safeId,
    input.statementType,
    input.membershipVersion,
    input.policyVersion,
    field(input.publicInputs.proposalCommitment),
    field(input.publicInputs.executionNullifier),
    field(input.publicInputs.membershipRoot),
    field(input.publicInputs.policyCommitment),
    field(input.publicInputs.safeStatus),
    field(input.publicInputs.cancelledProposalCommitment),
    field(input.disclosures.amount),
    field(input.disclosures.recipient),
    field(input.disclosures.executedAt),
    field(input.disclosures.proposalType),
  );
}

async function makeReferenceEnvelope(input: Omit<BlackoutReceiptEnvelope, 'protocol' | 'version' | 'proofSystem' | 'statementCommitment' | 'proof'>): Promise<BlackoutReceiptEnvelope> {
  const statementCommitment = await computeReceiptStatementCommitment(input);
  return {
    protocol: 'blackout-safe',
    version: 1,
    proofSystem: 'REFERENCE_ONLY',
    ...input,
    statementCommitment,
    proof: null,
  };
}

export async function buildQuorumReferenceReceipt(
  receipt: PublicQuorumReceipt,
  disclosures: BlackoutReceiptDisclosures = {},
): Promise<BlackoutReceiptEnvelope> {
  return makeReferenceEnvelope({
    safeId: receipt.safeId,
    statementType: 'QUORUM_AUTHORIZED',
    membershipVersion: receipt.membershipVersion,
    policyVersion: receipt.policyVersion,
    publicInputs: { proposalCommitment: receipt.proposalCommitment },
    disclosures,
  });
}

export async function buildExecutionReferenceReceipt(
  receipt: PublicExecutionReceipt,
  disclosures: BlackoutReceiptDisclosures = {},
): Promise<BlackoutReceiptEnvelope> {
  return makeReferenceEnvelope({
    safeId: receipt.safeId,
    statementType: 'EXECUTED_EXACTLY_ONCE',
    membershipVersion: receipt.membershipVersion,
    policyVersion: receipt.policyVersion,
    publicInputs: {
      proposalCommitment: receipt.proposalCommitment,
      executionNullifier: receipt.executionNullifier,
    },
    disclosures,
  });
}

export async function buildGovernanceReferenceReceipt(
  receipt: PublicGovernanceReceipt,
): Promise<BlackoutReceiptEnvelope> {
  const mapping: Record<PublicGovernanceReceipt['governanceAction'], BlackoutReceiptStatementType> = {
    ROTATE_MEMBERSHIP: 'MEMBERSHIP_ROTATED',
    CHANGE_POLICY: 'POLICY_CHANGED',
    PAUSE: 'SAFE_PAUSED',
    RESUME: 'SAFE_RESUMED',
    CANCEL_PROPOSAL: 'PROPOSAL_CANCELLED',
  };
  return makeReferenceEnvelope({
    safeId: receipt.safeId,
    statementType: mapping[receipt.governanceAction],
    membershipVersion: receipt.membershipVersion,
    policyVersion: receipt.policyVersion,
    publicInputs: {
      proposalCommitment: receipt.proposalCommitment,
      membershipRoot: receipt.membershipRoot,
      policyCommitment: receipt.policyCommitment,
      safeStatus: receipt.safeStatus,
      cancelledProposalCommitment: receipt.cancelledProposalCommitment,
    },
    disclosures: {},
  });
}

export async function assertReceiptIntegrity(receipt: BlackoutReceiptEnvelope): Promise<void> {
  assertReceiptShape(receipt);
  const recomputed = await computeReceiptStatementCommitment(receipt);
  if (recomputed !== receipt.statementCommitment) {
    throw new ReceiptError('RECEIPT_INTEGRITY_MISMATCH', 'receipt statement commitment does not match its public data');
  }
}

export interface MidnightReceiptVerifierAdapter {
  verifyReceipt(receipt: BlackoutReceiptEnvelope): Promise<boolean>;
}

export class UnavailableMidnightReceiptVerifier implements MidnightReceiptVerifierAdapter {
  async verifyReceipt(): Promise<boolean> {
    throw new ReceiptError('MIDNIGHT_VERIFIER_UNAVAILABLE', 'No real Midnight proof verifier is configured for Blackout Verify.');
  }
}

export async function verifyBlackoutReceipt(
  receipt: BlackoutReceiptEnvelope,
  verifier: MidnightReceiptVerifierAdapter,
  mode: 'LIVE' | 'REFERENCE' = 'LIVE',
): Promise<ReceiptVerificationResult> {
  try {
    await assertReceiptIntegrity(receipt);
  } catch {
    return { valid: false, cryptographicallyVerified: false, code: 'RECEIPT_INTEGRITY_MISMATCH' };
  }

  if (receipt.proofSystem === 'REFERENCE_ONLY') {
    if (mode === 'LIVE') {
      return { valid: false, cryptographicallyVerified: false, code: 'REFERENCE_PROOF_NOT_ACCEPTED' };
    }
    return { valid: true, cryptographicallyVerified: false, code: 'REFERENCE_INTEGRITY_ONLY' };
  }

  if (!receipt.proof) {
    return { valid: false, cryptographicallyVerified: false, code: 'MISSING_MIDNIGHT_PROOF' };
  }

  try {
    const valid = await verifier.verifyReceipt(receipt);
    return valid
      ? { valid: true, cryptographicallyVerified: true, code: 'MIDNIGHT_PROOF_VERIFIED' }
      : { valid: false, cryptographicallyVerified: false, code: 'MIDNIGHT_PROOF_INVALID' };
  } catch (error) {
    if (error instanceof ReceiptError && error.code === 'MIDNIGHT_VERIFIER_UNAVAILABLE') {
      return { valid: false, cryptographicallyVerified: false, code: 'MIDNIGHT_VERIFIER_UNAVAILABLE' };
    }
    return { valid: false, cryptographicallyVerified: false, code: 'MIDNIGHT_PROOF_INVALID' };
  }
}

/**
 * Blackout Verify transport adapter. It accepts the canonical Safe envelope but
 * deliberately performs no fake local ZK verification in LIVE mode.
 */
export interface BlackoutVerifyPayload {
  protocol: 'blackout-safe';
  version: 1;
  receipt: BlackoutReceiptEnvelope;
}

export function toBlackoutVerifyPayload(receipt: BlackoutReceiptEnvelope): BlackoutVerifyPayload {
  return { protocol: 'blackout-safe', version: 1, receipt };
}

/** Useful when generating disclosure UX; does not imply proof verification. */
export function safeStateReceiptContext(state: PublicSafeState): Pick<BlackoutReceiptPublicInputs, 'membershipRoot' | 'policyCommitment' | 'safeStatus'> {
  return {
    membershipRoot: state.membershipRoot,
    policyCommitment: state.policyCommitment,
    safeStatus: state.status,
  };
}
