import { domainHash } from './crypto.ts';
import type {
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
  if (receipt.protocol !== 'blackout-safe' || receipt.version !== 1) {
    throw new ReceiptError('UNSUPPORTED_RECEIPT', 'unsupported Blackout Safe receipt format');
  }
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
