import { computeProposalCommitment } from './crypto.ts';
import type { Hex32, PrivateProposalPayload } from './model.ts';

export class ProposalIntegrityError extends Error {
  readonly code: 'COMMITMENT_MISMATCH' | 'DECRYPTION_UNAVAILABLE' | 'INVALID_PAYLOAD';

  constructor(code: ProposalIntegrityError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'ProposalIntegrityError';
  }
}

/**
 * Transport-neutral authenticated-encryption envelope.
 * BLACKOUT SAFE does not pretend Midnight supplies group messaging.
 * A later transport adapter must decrypt/authenticate this envelope locally.
 */
export interface ProposalCiphertextEnvelope {
  version: 1;
  proposalCommitment: Hex32;
  algorithm: string;
  senderKeyId: string;
  nonce: string;
  ciphertext: string;
  authenticationTag: string;
}

export interface ProposalDecryptionAdapter {
  decryptAndAuthenticate(envelope: ProposalCiphertextEnvelope): Promise<PrivateProposalPayload>;
}

export async function assertProposalCommitmentMatches(
  payload: PrivateProposalPayload,
  expectedCommitment: Hex32,
): Promise<void> {
  const actual = await computeProposalCommitment(payload);
  if (actual !== expectedCommitment) {
    throw new ProposalIntegrityError(
      'COMMITMENT_MISMATCH',
      'Decrypted proposal payload does not match the on-chain proposal commitment.',
    );
  }
}

export async function openAndVerifyProposal(
  envelope: ProposalCiphertextEnvelope,
  adapter?: ProposalDecryptionAdapter,
): Promise<PrivateProposalPayload> {
  if (!adapter) {
    throw new ProposalIntegrityError(
      'DECRYPTION_UNAVAILABLE',
      'No authenticated proposal decryption adapter is configured. Fail closed.',
    );
  }
  const payload = await adapter.decryptAndAuthenticate(envelope);
  await assertProposalCommitmentMatches(payload, envelope.proposalCommitment);
  return payload;
}
