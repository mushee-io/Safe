import { Buffer } from 'buffer';
import type { PrivatePolicyWitness, PrivateProposalPayload } from '../../contract/build-safe/contract/index.js';
import { buildBlackoutSafeWitnesses } from '../safe/midnight/witnesses.ts';
import {
  clearActiveSafeLaceSession,
  connectBlackoutSafeLace,
  requirePreviewDust,
  type SafeLaceSession,
} from '../safe/midnight/wallet-session.ts';
import {
  deployBlackoutSafe,
  submitBlackoutSafeCall,
  unavailableBlackoutSafeWitnesses,
  type BlackoutSafeCircuitId,
} from '../safe/midnight/live-safe.ts';
import {
  bytesToHex32,
  createMembershipSetup,
  decodePolicyOpening,
  decodeProposalBundle,
  decodeSignerKit,
  exactGovernanceBytesCommitment,
  exactGovernanceRootCommitment,
  exactGovernanceSimpleCommitment,
  exactPolicyCommitment,
  exactProposalCommitment,
  fieldToHex32,
  hex32ToBytes,
  hex32ToFieldDigest,
  padAscii32,
  randomBytes32,
  serializePolicyOpening,
  serializeProposalBundle,
  witnessBundleForSigner,
  type Hex32String,
  type MembershipSetup,
  type SerializedPolicyOpening,
  type SerializedProposalBundle,
  type SerializedSafeSignerKit,
} from '../safe/midnight/live-encoding.ts';

const globals = globalThis as typeof globalThis & { Buffer?: typeof Buffer; global?: typeof globalThis };
if (!globals.Buffer) globals.Buffer = Buffer;
if (!globals.global) globals.global = globalThis;

export interface WalletView {
  walletName: string;
  connectorId: string;
  networkId: 'preview';
  dust: string;
  shieldedAddress?: string;
  shieldedCoinPublicKey?: string;
  shieldedEncryptionPublicKey?: string;
}

export interface PublicSafeRecord {
  version: 1;
  networkId: 'preview';
  safeId: Hex32String;
  membershipRoot: Hex32String;
  membershipVersion: string;
  policyCommitment: Hex32String;
  policyVersion: string;
  policyMode: 'STANDARD' | 'PRIVATE_POLICY';
  publicQuorum: string | null;
  contractAddress: string;
  deploymentTxId: string;
  deploymentBlockHeight: number;
  deploymentVerifiedOnChain: boolean;
  createdAt: string;
}

export interface BootstrapResult {
  membership: MembershipSetup;
  policy: PrivatePolicyWitness;
  policyOpening: SerializedPolicyOpening;
  policyCommitment: Uint8Array;
}

export interface TxResultView {
  txId: string;
  blockHeight: number;
  circuitId: BlackoutSafeCircuitId | 'deploy';
}

export type GovernanceAction = 'PAUSE' | 'RESUME' | 'CANCEL_PROPOSAL' | 'ROTATE_MEMBERSHIP' | 'CHANGE_POLICY';

let connectedSession: SafeLaceSession | null = null;

function sameHex(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/^0x/, '') === b.trim().toLowerCase().replace(/^0x/, '');
}

function assertSameSafe(record: PublicSafeRecord, candidate: string, label: string): void {
  if (!sameHex(record.safeId, candidate)) throw new Error(`${label}_SAFE_ID_MISMATCH`);
}

function zero32(): Uint8Array {
  return new Uint8Array(32);
}

function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export function currentSession(): SafeLaceSession | null {
  return connectedSession;
}

export async function connectWallet(): Promise<WalletView> {
  const session = await connectBlackoutSafeLace();
  const dust = await requirePreviewDust(session);
  connectedSession = session;
  return {
    walletName: session.walletName,
    connectorId: session.connectorId,
    networkId: 'preview',
    dust: dust.toString(),
    shieldedAddress: session.addresses.shieldedAddress,
    shieldedCoinPublicKey: session.addresses.shieldedCoinPublicKey,
    shieldedEncryptionPublicKey: session.addresses.shieldedEncryptionPublicKey,
  };
}

export function disconnectWallet(): void {
  clearActiveSafeLaceSession();
  connectedSession = null;
}

export async function refreshWallet(): Promise<WalletView> {
  if (!connectedSession) throw new Error('BLACKOUT_SAFE_LACE_SESSION_REQUIRED');
  const dust = await requirePreviewDust(connectedSession);
  return {
    walletName: connectedSession.walletName,
    connectorId: connectedSession.connectorId,
    networkId: 'preview',
    dust: dust.toString(),
    shieldedAddress: connectedSession.addresses.shieldedAddress,
    shieldedCoinPublicKey: connectedSession.addresses.shieldedCoinPublicKey,
    shieldedEncryptionPublicKey: connectedSession.addresses.shieldedEncryptionPublicKey,
  };
}

export function bootstrapSafe(input: {
  memberCount: number;
  mode: 'STANDARD' | 'PRIVATE_POLICY';
  threshold: bigint;
  maxTransferAmount: bigint;
  maxProposalLifetime: bigint;
  minExecutionDelay: bigint;
}): BootstrapResult {
  if (input.threshold <= 0n || input.threshold > BigInt(input.memberCount)) {
    throw new Error('BLACKOUT_SAFE_THRESHOLD_OUTSIDE_MEMBER_SET');
  }
  const membership = createMembershipSetup(input.memberCount);
  const policy: PrivatePolicyWitness = {
    is_private: input.mode === 'PRIVATE_POLICY',
    threshold: input.threshold,
    max_transfer_amount: input.maxTransferAmount,
    max_proposal_lifetime: input.maxProposalLifetime,
    min_execution_delay: input.minExecutionDelay,
    membership_version: 1n,
    policy_version: 1n,
    salt: input.mode === 'PRIVATE_POLICY' ? randomBytes32() : zero32(),
  };
  const policyCommitment = exactPolicyCommitment(policy);
  return {
    membership,
    policy,
    policyOpening: serializePolicyOpening(membership.safeId, policy),
    policyCommitment,
  };
}

export async function deployBootstrap(bootstrap: BootstrapResult): Promise<PublicSafeRecord> {
  if (!connectedSession) throw new Error('BLACKOUT_SAFE_LACE_SESSION_REQUIRED');
  const deployed = await deployBlackoutSafe({
    session: connectedSession,
    safeId: bootstrap.membership.safeId,
    membershipRoot: bootstrap.membership.root,
    policyCommitment: bootstrap.policyCommitment,
    policyIsPrivate: bootstrap.policy.is_private,
    standardRequiredQuorum: bootstrap.policy.is_private ? 0n : bootstrap.policy.threshold,
  });
  return {
    version: 1,
    networkId: 'preview',
    safeId: bytesToHex32(bootstrap.membership.safeId),
    membershipRoot: fieldToHex32(bootstrap.membership.root.field),
    membershipVersion: '1',
    policyCommitment: bytesToHex32(bootstrap.policyCommitment),
    policyVersion: '1',
    policyMode: bootstrap.policy.is_private ? 'PRIVATE_POLICY' : 'STANDARD',
    publicQuorum: bootstrap.policy.is_private ? null : bootstrap.policy.threshold.toString(),
    contractAddress: deployed.contractAddress,
    deploymentTxId: deployed.txId,
    deploymentBlockHeight: deployed.blockHeight,
    deploymentVerifiedOnChain: false,
    createdAt: new Date().toISOString(),
  };
}

export function attachExistingSafe(input: Omit<PublicSafeRecord, 'version' | 'networkId' | 'createdAt'>): PublicSafeRecord {
  hex32ToBytes(input.safeId);
  hex32ToBytes(input.membershipRoot);
  hex32ToBytes(input.policyCommitment);
  if (!/^(?:0x)?(?:0200)?[0-9a-fA-F]{64}$/.test(input.contractAddress.trim())) {
    throw new Error('BLACKOUT_SAFE_INVALID_CONTRACT_ADDRESS');
  }
  if (!/^(?:0x)?[0-9a-fA-F]{64}$/.test(input.deploymentTxId.trim())) {
    throw new Error('BLACKOUT_SAFE_INVALID_DEPLOYMENT_TX_ID');
  }
  return { ...input, version: 1, networkId: 'preview', createdAt: new Date().toISOString() };
}

export async function depositShielded(
  safe: PublicSafeRecord,
  color: Hex32String,
  value: bigint,
): Promise<TxResultView> {
  if (value <= 0n) throw new Error('BLACKOUT_SAFE_DEPOSIT_VALUE_MUST_BE_POSITIVE');
  const result = await submitBlackoutSafeCall({
    session: connectedSession ?? undefined,
    contractAddress: safe.contractAddress,
    circuitId: 'deposit_shielded',
    args: [{ nonce: randomBytes32(), color: hex32ToBytes(color), value }],
    witnesses: unavailableBlackoutSafeWitnesses(),
  });
  return { txId: result.txId, blockHeight: result.blockHeight, circuitId: result.circuitId };
}

export async function createTransferProposal(input: {
  safe: PublicSafeRecord;
  signerKit: SerializedSafeSignerKit;
  policyOpening: SerializedPolicyOpening;
  asset: Hex32String;
  recipientCoinPublicKey: Hex32String;
  amount: bigint;
  memoHash?: Hex32String;
  lifetimeSeconds: bigint;
}): Promise<{ tx: TxResultView; proposalBundle: SerializedProposalBundle }> {
  const signer = decodeSignerKit(input.signerKit);
  const policy = decodePolicyOpening(input.policyOpening);
  assertSameSafe(input.safe, bytesToHex32(signer.safeId), 'BLACKOUT_SAFE_SIGNER');
  assertSameSafe(input.safe, bytesToHex32(policy.safeId), 'BLACKOUT_SAFE_POLICY');
  if (input.amount <= 0n) throw new Error('BLACKOUT_SAFE_INVALID_AMOUNT');
  if (input.lifetimeSeconds <= 0n) throw new Error('BLACKOUT_SAFE_INVALID_PROPOSAL_LIFETIME');

  const createdAt = nowSeconds();
  const payload: PrivateProposalPayload = {
    action_type: padAscii32('TRANSFER'),
    asset: hex32ToBytes(input.asset),
    recipient: hex32ToBytes(input.recipientCoinPublicKey),
    amount: input.amount,
    calldata_or_action: padAscii32('TRANSFER'),
    memo_hash: input.memoHash ? hex32ToBytes(input.memoHash) : randomBytes32(),
    created_at: createdAt,
    expires_at: createdAt + input.lifetimeSeconds,
    nonce: randomBytes32(),
    salt: randomBytes32(),
  };
  const safeId = hex32ToBytes(input.safe.safeId);
  const commitment = exactProposalCommitment(safeId, payload);
  const proposalBundle = serializeProposalBundle(safeId, commitment, payload);
  const witnesses = buildBlackoutSafeWitnesses(
    witnessBundleForSigner(input.signerKit, input.policyOpening, proposalBundle),
  );
  const result = await submitBlackoutSafeCall({
    session: connectedSession ?? undefined,
    contractAddress: input.safe.contractAddress,
    circuitId: 'propose_private',
    args: [commitment],
    witnesses,
  });
  return {
    tx: { txId: result.txId, blockHeight: result.blockHeight, circuitId: result.circuitId },
    proposalBundle,
  };
}

export async function approveProposal(input: {
  safe: PublicSafeRecord;
  signerKit: SerializedSafeSignerKit;
  proposalCommitment: Hex32String;
  proposalBundle?: SerializedProposalBundle;
}): Promise<TxResultView> {
  const signer = decodeSignerKit(input.signerKit);
  assertSameSafe(input.safe, bytesToHex32(signer.safeId), 'BLACKOUT_SAFE_SIGNER');
  if (input.proposalBundle) assertSameSafe(input.safe, input.proposalBundle.safeId, 'BLACKOUT_SAFE_PROPOSAL');
  const witnesses = buildBlackoutSafeWitnesses(
    witnessBundleForSigner(input.signerKit, undefined, input.proposalBundle),
  );
  const result = await submitBlackoutSafeCall({
    session: connectedSession ?? undefined,
    contractAddress: input.safe.contractAddress,
    circuitId: 'approve_private',
    args: [hex32ToBytes(input.proposalCommitment)],
    witnesses,
  });
  return { txId: result.txId, blockHeight: result.blockHeight, circuitId: result.circuitId };
}

export async function proveQuorum(input: {
  safe: PublicSafeRecord;
  policyOpening: SerializedPolicyOpening;
  proposalCommitment: Hex32String;
}): Promise<TxResultView> {
  const decoded = decodePolicyOpening(input.policyOpening);
  assertSameSafe(input.safe, bytesToHex32(decoded.safeId), 'BLACKOUT_SAFE_POLICY');
  const witnesses = buildBlackoutSafeWitnesses({ policy: decoded.policy as any });
  const result = await submitBlackoutSafeCall({
    session: connectedSession ?? undefined,
    contractAddress: input.safe.contractAddress,
    circuitId: 'prove_quorum',
    args: [hex32ToBytes(input.proposalCommitment)],
    witnesses,
  });
  return { txId: result.txId, blockHeight: result.blockHeight, circuitId: result.circuitId };
}

export async function executeTransfer(input: {
  safe: PublicSafeRecord;
  policyOpening: SerializedPolicyOpening;
  proposalBundle: SerializedProposalBundle;
  heldCoin: { nonce: Hex32String; color: Hex32String; value: string; mt_index: string };
}): Promise<TxResultView> {
  assertSameSafe(input.safe, input.proposalBundle.safeId, 'BLACKOUT_SAFE_PROPOSAL');
  assertSameSafe(input.safe, input.policyOpening.safeId, 'BLACKOUT_SAFE_POLICY');
  const proposal = decodeProposalBundle(input.proposalBundle);
  const decodedPolicy = decodePolicyOpening(input.policyOpening);
  const witnesses = buildBlackoutSafeWitnesses({
    privateProposal: proposal.payload as any,
    policy: decodedPolicy.policy as any,
    heldCoin: {
      nonce: hex32ToBytes(input.heldCoin.nonce),
      color: hex32ToBytes(input.heldCoin.color),
      value: BigInt(input.heldCoin.value),
      mt_index: BigInt(input.heldCoin.mt_index),
    } as any,
  });
  const result = await submitBlackoutSafeCall({
    session: connectedSession ?? undefined,
    contractAddress: input.safe.contractAddress,
    circuitId: 'execute_shielded_transfer',
    args: [proposal.proposalCommitment],
    witnesses,
  });
  return { txId: result.txId, blockHeight: result.blockHeight, circuitId: result.circuitId };
}

export async function createGovernanceProposal(input: {
  safe: PublicSafeRecord;
  signerKit: SerializedSafeSignerKit;
  policyOpening: SerializedPolicyOpening;
  action: GovernanceAction;
  lifetimeSeconds: bigint;
  targetProposal?: Hex32String;
  newMembershipRoot?: Hex32String;
  nextPolicy?: SerializedPolicyOpening;
}): Promise<{ tx: TxResultView; proposalBundle: SerializedProposalBundle }> {
  const signer = decodeSignerKit(input.signerKit);
  const currentPolicy = decodePolicyOpening(input.policyOpening);
  assertSameSafe(input.safe, bytesToHex32(signer.safeId), 'BLACKOUT_SAFE_SIGNER');
  assertSameSafe(input.safe, bytesToHex32(currentPolicy.safeId), 'BLACKOUT_SAFE_POLICY');
  const safeId = hex32ToBytes(input.safe.safeId);
  let actionCommitment: Uint8Array;

  switch (input.action) {
    case 'PAUSE':
    case 'RESUME':
      actionCommitment = exactGovernanceSimpleCommitment(safeId, input.action);
      break;
    case 'CANCEL_PROPOSAL':
      if (!input.targetProposal) throw new Error('BLACKOUT_SAFE_CANCEL_TARGET_REQUIRED');
      actionCommitment = exactGovernanceBytesCommitment(safeId, 'CANCEL_PROPOSAL', hex32ToBytes(input.targetProposal));
      break;
    case 'ROTATE_MEMBERSHIP':
      if (!input.newMembershipRoot) throw new Error('BLACKOUT_SAFE_NEW_MEMBERSHIP_ROOT_REQUIRED');
      actionCommitment = exactGovernanceRootCommitment(
        safeId,
        'ROTATE_MEMBERSHIP',
        hex32ToFieldDigest(input.newMembershipRoot),
      );
      break;
    case 'CHANGE_POLICY': {
      if (!input.nextPolicy) throw new Error('BLACKOUT_SAFE_NEXT_POLICY_REQUIRED');
      assertSameSafe(input.safe, input.nextPolicy.safeId, 'BLACKOUT_SAFE_NEXT_POLICY');
      const next = decodePolicyOpening(input.nextPolicy).policy;
      actionCommitment = exactGovernanceBytesCommitment(safeId, 'CHANGE_POLICY', exactPolicyCommitment(next));
      break;
    }
  }

  const createdAt = nowSeconds();
  const payload: PrivateProposalPayload = {
    action_type: padAscii32('GOVERNANCE'),
    asset: zero32(),
    recipient: zero32(),
    amount: 0n,
    calldata_or_action: actionCommitment,
    memo_hash: randomBytes32(),
    created_at: createdAt,
    expires_at: createdAt + input.lifetimeSeconds,
    nonce: randomBytes32(),
    salt: randomBytes32(),
  };
  const proposalCommitment = exactProposalCommitment(safeId, payload);
  const proposalBundle = serializeProposalBundle(safeId, proposalCommitment, payload);
  const witnesses = buildBlackoutSafeWitnesses(
    witnessBundleForSigner(input.signerKit, input.policyOpening, proposalBundle),
  );
  const result = await submitBlackoutSafeCall({
    session: connectedSession ?? undefined,
    contractAddress: input.safe.contractAddress,
    circuitId: 'propose_private',
    args: [proposalCommitment],
    witnesses,
  });
  return {
    tx: { txId: result.txId, blockHeight: result.blockHeight, circuitId: result.circuitId },
    proposalBundle,
  };
}

export async function executeGovernance(input: {
  safe: PublicSafeRecord;
  action: GovernanceAction;
  policyOpening: SerializedPolicyOpening;
  proposalBundle: SerializedProposalBundle;
  targetProposal?: Hex32String;
  newMembershipRoot?: Hex32String;
  nextPolicy?: SerializedPolicyOpening;
}): Promise<TxResultView> {
  assertSameSafe(input.safe, input.policyOpening.safeId, 'BLACKOUT_SAFE_POLICY');
  assertSameSafe(input.safe, input.proposalBundle.safeId, 'BLACKOUT_SAFE_PROPOSAL');
  const current = decodePolicyOpening(input.policyOpening).policy;
  const proposal = decodeProposalBundle(input.proposalBundle);
  const witnessBundle: any = { policy: current, privateProposal: proposal.payload };
  if (input.nextPolicy) {
    assertSameSafe(input.safe, input.nextPolicy.safeId, 'BLACKOUT_SAFE_NEXT_POLICY');
    witnessBundle.nextPolicy = decodePolicyOpening(input.nextPolicy).policy;
  }
  const witnesses = buildBlackoutSafeWitnesses(witnessBundle);
  let circuitId: BlackoutSafeCircuitId;
  let args: unknown[] = [proposal.proposalCommitment];

  switch (input.action) {
    case 'PAUSE':
      circuitId = 'governance_pause';
      break;
    case 'RESUME':
      circuitId = 'governance_resume';
      break;
    case 'CANCEL_PROPOSAL':
      if (!input.targetProposal) throw new Error('BLACKOUT_SAFE_CANCEL_TARGET_REQUIRED');
      circuitId = 'governance_cancel_proposal';
      args.push(hex32ToBytes(input.targetProposal));
      break;
    case 'ROTATE_MEMBERSHIP':
      if (!input.newMembershipRoot) throw new Error('BLACKOUT_SAFE_NEW_MEMBERSHIP_ROOT_REQUIRED');
      if (!input.nextPolicy) throw new Error('BLACKOUT_SAFE_NEXT_POLICY_REQUIRED');
      circuitId = 'governance_rotate_membership';
      args.push(hex32ToFieldDigest(input.newMembershipRoot));
      break;
    case 'CHANGE_POLICY':
      if (!input.nextPolicy) throw new Error('BLACKOUT_SAFE_NEXT_POLICY_REQUIRED');
      circuitId = 'governance_change_policy';
      break;
  }

  const result = await submitBlackoutSafeCall({
    session: connectedSession ?? undefined,
    contractAddress: input.safe.contractAddress,
    circuitId,
    args,
    witnesses,
  });
  return { txId: result.txId, blockHeight: result.blockHeight, circuitId: result.circuitId };
}

export async function runReceiptCircuit(input: {
  safe: PublicSafeRecord;
  circuitId:
    | 'receipt_quorum_authorized'
    | 'receipt_executed_exactly_once'
    | 'receipt_disclose_amount'
    | 'receipt_disclose_recipient'
    | 'receipt_proposal_cancelled';
  proposalCommitment: Hex32String;
  policyOpening?: SerializedPolicyOpening;
  proposalBundle?: SerializedProposalBundle;
}): Promise<TxResultView> {
  const witnessBundle: any = {};
  if (input.policyOpening) {
    assertSameSafe(input.safe, input.policyOpening.safeId, 'BLACKOUT_SAFE_POLICY');
    witnessBundle.policy = decodePolicyOpening(input.policyOpening).policy;
  }
  if (input.proposalBundle) {
    assertSameSafe(input.safe, input.proposalBundle.safeId, 'BLACKOUT_SAFE_PROPOSAL');
    witnessBundle.privateProposal = decodeProposalBundle(input.proposalBundle).payload;
  }
  const result = await submitBlackoutSafeCall({
    session: connectedSession ?? undefined,
    contractAddress: input.safe.contractAddress,
    circuitId: input.circuitId,
    args: [hex32ToBytes(input.proposalCommitment)],
    witnesses: buildBlackoutSafeWitnesses(witnessBundle),
  });
  return { txId: result.txId, blockHeight: result.blockHeight, circuitId: result.circuitId };
}

export function safePublicSummary(safe: PublicSafeRecord | null): Record<string, string> {
  if (!safe) return {};
  return {
    safeId: safe.safeId,
    membershipRoot: safe.membershipRoot,
    policyCommitment: safe.policyCommitment,
    contractAddress: safe.contractAddress,
    deploymentTxId: safe.deploymentTxId,
    blockHeight: String(safe.deploymentBlockHeight),
  };
}
