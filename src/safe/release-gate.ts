export interface BlackoutSafeReleaseEvidence {
  fullZkArtifactsGenerated: boolean;
  compilerPinned0311: boolean;
  strictTypecheckPassed: boolean;
  protocolTestsPassed: boolean;
  generatedBindingIntegrated: boolean;
  lacePreviewProviderIntegrated: boolean;
  previewDeploymentTxId?: string;
  previewContractAddress?: string;
  previewDeploymentNetworkId?: string;
  previewDeploymentFinalized?: boolean;
  /** Must come from a real Preview indexer/node lookup, never from local syntax checks. */
  previewDeploymentVerifiedOnChain?: boolean;
  multiUserPreviewValidated: boolean;
  liveShieldedExecutionValidated: boolean;
  liveReceiptVerificationValidated: boolean;
}

export type BlackoutSafeReleaseStage =
  | 'BUILD_BLOCKED'
  | 'PREVIEW_READY'
  | 'PREVIEW_DEPLOYED'
  | 'PRODUCTION_BLOCKED';

export interface BlackoutSafeReleaseGate {
  stage: BlackoutSafeReleaseStage;
  readyForPreviewDeploy: boolean;
  deployedOnPreview: boolean;
  readyForProduction: false;
  blockers: string[];
}

const isHex64 = (value: string | undefined): boolean => !!value && /^[0-9a-f]{64}$/i.test(value);
const isMidnightTxIdentifier = (value: string | undefined): boolean =>
  !!value && /^(?:[0-9a-f]{64}|[0-9a-f]{66})$/i.test(value);

/**
 * Fail-closed release gate. Production is intentionally never auto-approved:
 * a manual security/privacy review remains mandatory even after Preview passes.
 */
export function evaluateBlackoutSafeRelease(evidence: BlackoutSafeReleaseEvidence): BlackoutSafeReleaseGate {
  const buildBlockers: string[] = [];
  if (!evidence.compilerPinned0311) buildBlockers.push('COMPACT_0_31_1_NOT_PINNED');
  if (!evidence.fullZkArtifactsGenerated) buildBlockers.push('FULL_ZK_ARTIFACTS_NOT_VERIFIED');
  if (!evidence.strictTypecheckPassed) buildBlockers.push('STRICT_TYPECHECK_NOT_GREEN');
  if (!evidence.protocolTestsPassed) buildBlockers.push('PROTOCOL_TESTS_NOT_GREEN');
  if (!evidence.generatedBindingIntegrated) buildBlockers.push('GENERATED_BINDING_NOT_INTEGRATED');
  if (!evidence.lacePreviewProviderIntegrated) buildBlockers.push('LACE_PREVIEW_PROVIDER_NOT_INTEGRATED');

  if (buildBlockers.length > 0) {
    return {
      stage: 'BUILD_BLOCKED',
      readyForPreviewDeploy: false,
      deployedOnPreview: false,
      readyForProduction: false,
      blockers: buildBlockers,
    };
  }

  const identifiersPresent =
    isMidnightTxIdentifier(evidence.previewDeploymentTxId) && isHex64(evidence.previewContractAddress);
  const networkVerified =
    identifiersPresent &&
    evidence.previewDeploymentNetworkId === 'preview' &&
    evidence.previewDeploymentFinalized === true &&
    evidence.previewDeploymentVerifiedOnChain === true;

  if (!networkVerified) {
    const blockers = identifiersPresent
      ? ['PREVIEW_DEPLOYMENT_NOT_NETWORK_VERIFIED']
      : ['PREVIEW_DEPLOYMENT_NOT_VERIFIED'];
    return {
      stage: 'PREVIEW_READY',
      readyForPreviewDeploy: true,
      deployedOnPreview: false,
      readyForProduction: false,
      blockers,
    };
  }

  const previewBlockers: string[] = [];
  if (!evidence.multiUserPreviewValidated) previewBlockers.push('MULTI_USER_PREVIEW_NOT_VALIDATED');
  if (!evidence.liveShieldedExecutionValidated) previewBlockers.push('LIVE_SHIELDED_EXECUTION_NOT_VALIDATED');
  if (!evidence.liveReceiptVerificationValidated) previewBlockers.push('LIVE_RECEIPT_VERIFICATION_NOT_VALIDATED');

  return {
    stage: previewBlockers.length === 0 ? 'PRODUCTION_BLOCKED' : 'PREVIEW_DEPLOYED',
    readyForPreviewDeploy: true,
    deployedOnPreview: true,
    readyForProduction: false,
    blockers: previewBlockers.length > 0
      ? previewBlockers
      : ['MANUAL_SECURITY_PRIVACY_REVIEW_REQUIRED_BEFORE_PRODUCTION'],
  };
}
