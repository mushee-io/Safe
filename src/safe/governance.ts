import { computePolicyCommitment, domainHash } from './crypto.ts';
import type { GovernanceOperation, Hex32 } from './model.ts';

export class GovernanceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'GovernanceError';
  }
}

/**
 * Commits the full governance operation without putting the operation payload
 * itself into public proposal state.
 */
export async function computeGovernanceOperationCommitment(operation: GovernanceOperation): Promise<Hex32> {
  switch (operation.action) {
    case 'ROTATE_MEMBERSHIP':
      return domainHash('blackout:safe:governance:v1', operation.action, operation.newMembershipRoot);
    case 'CHANGE_POLICY': {
      const policyCommitment = await computePolicyCommitment(operation.newPolicy);
      return domainHash(
        'blackout:safe:governance:v1',
        operation.action,
        policyCommitment,
        operation.newPolicy.membershipVersion,
        operation.newPolicy.policyVersion,
      );
    }
    case 'PAUSE':
    case 'RESUME':
      return domainHash('blackout:safe:governance:v1', operation.action);
    case 'CANCEL_PROPOSAL':
      return domainHash('blackout:safe:governance:v1', operation.action, operation.targetProposalCommitment);
  }
}
