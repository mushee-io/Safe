import { Contract, type PrivatePolicyWitness, type PrivateProposalPayload } from '../../../contract/build-safe/contract/index.js';
import type { BlackoutSafeEphemeralWitnessBundle } from './witnesses.ts';

export type Hex32String = `0x${string}`;

const ZERO_32 = new Uint8Array(32);
const MEMBER_TREE_DEPTH = 10;
const MEMBER_TREE_CAPACITY = 2 ** MEMBER_TREE_DEPTH;
const LEAF_DOMAIN = new Uint8Array([109, 100, 110, 58, 108, 104]); // mdn:lh
const PROPOSAL_DOMAIN = padAscii32('blackout:safe:proposal:v1');
const GOVERNANCE_DOMAIN = padAscii32('blackout:safe:governance:v1');

// The compiler is pinned to Compact 0.31.1. These helpers intentionally use the
// generated contract's exact hashing internals so the browser never substitutes
// the SHA-256 reference helpers for LIVE commitments.
const exactContract = new Contract({} as any) as any;

export interface SerializedSafeSignerKit {
  format: 'BLACKOUT_SAFE_SIGNER_KIT_V1';
  safeId: Hex32String;
  membershipVersion: string;
  memberSecret: Hex32String;
  memberCommitment: Hex32String;
  memberPath: {
    is_some: true;
    value: {
      leaf: Hex32String;
      path: Array<{ sibling: Hex32String; goes_left: boolean }>;
    };
  };
}

export interface SerializedPolicyOpening {
  format: 'BLACKOUT_SAFE_POLICY_OPENING_V1';
  safeId: Hex32String;
  is_private: boolean;
  threshold: string;
  max_transfer_amount: string;
  max_proposal_lifetime: string;
  min_execution_delay: string;
  membership_version: string;
  policy_version: string;
  salt: Hex32String;
}

export interface SerializedProposalBundle {
  format: 'BLACKOUT_SAFE_PROPOSAL_BUNDLE_V1';
  safeId: Hex32String;
  proposalCommitment: Hex32String;
  payload: {
    action_type: Hex32String;
    asset: Hex32String;
    recipient: Hex32String;
    amount: string;
    calldata_or_action: Hex32String;
    memo_hash: Hex32String;
    created_at: string;
    expires_at: string;
    nonce: Hex32String;
    salt: Hex32String;
  };
}

export interface MembershipSetup {
  safeId: Uint8Array;
  root: { field: bigint };
  rootHex: Hex32String;
  kits: SerializedSafeSignerKit[];
}

export function bytesToHex32(value: Uint8Array): Hex32String {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new Error('BLACKOUT_SAFE_HEX32_REQUIRES_32_BYTES');
  }
  return `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function hex32ToBytes(value: string): Uint8Array {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) throw new Error('BLACKOUT_SAFE_INVALID_HEX32');
  return new Uint8Array(normalized.slice(2).match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}

export function fieldToHex32(value: bigint): Hex32String {
  if (value < 0n) throw new Error('BLACKOUT_SAFE_NEGATIVE_FIELD');
  const hex = value.toString(16);
  if (hex.length > 64) throw new Error('BLACKOUT_SAFE_FIELD_TOO_LARGE');
  return `0x${hex.padStart(64, '0')}`;
}

export function hex32ToFieldDigest(value: string): { field: bigint } {
  const bytes = hex32ToBytes(value);
  return { field: BigInt(bytesToHex32(bytes)) };
}

export function randomBytes32(): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) throw new Error('BLACKOUT_SAFE_SECURE_RANDOM_UNAVAILABLE');
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

export function padAscii32(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length > 32) throw new Error('BLACKOUT_SAFE_ASCII_TAG_TOO_LONG');
  const output = new Uint8Array(32);
  output.set(encoded);
  return output;
}

export function exactMemberCommitment(secret: Uint8Array): Uint8Array {
  if (secret.length !== 32) throw new Error('BLACKOUT_SAFE_MEMBER_SECRET_MUST_BE_32_BYTES');
  return exactContract._member_commitment_0(secret);
}

function exactLeafDigest(leaf: Uint8Array): bigint {
  const persistent = exactContract._persistentHash_1({ domain_sep: LEAF_DOMAIN, data: leaf });
  return exactContract._degradeToTransient_0(persistent);
}

function exactParentDigest(left: bigint, right: bigint): bigint {
  return exactContract._transientHash_0([left, right]);
}

export function exactPolicyCommitment(policy: PrivatePolicyWitness): Uint8Array {
  return exactContract._private_policy_commitment_0(policy);
}

export function exactProposalCommitment(safeId: Uint8Array, payload: PrivateProposalPayload): Uint8Array {
  if (safeId.length !== 32) throw new Error('BLACKOUT_SAFE_SAFE_ID_MUST_BE_32_BYTES');
  return exactContract._persistentHash_7([
    PROPOSAL_DOMAIN,
    safeId,
    payload.action_type,
    payload.asset,
    payload.recipient,
    payload.amount,
    payload.calldata_or_action,
    payload.memo_hash,
    payload.created_at,
    payload.expires_at,
    payload.nonce,
    payload.salt,
  ]);
}

export function exactGovernanceSimpleCommitment(safeId: Uint8Array, action: string): Uint8Array {
  return exactContract._persistentHash_3([GOVERNANCE_DOMAIN, safeId, padAscii32(action)]);
}

export function exactGovernanceBytesCommitment(
  safeId: Uint8Array,
  action: string,
  value: Uint8Array,
): Uint8Array {
  if (value.length !== 32) throw new Error('BLACKOUT_SAFE_GOVERNANCE_VALUE_MUST_BE_32_BYTES');
  return exactContract._persistentHash_6([GOVERNANCE_DOMAIN, safeId, padAscii32(action), value]);
}

export function exactGovernanceRootCommitment(
  safeId: Uint8Array,
  action: string,
  root: { field: bigint },
): Uint8Array {
  return exactContract._persistentHash_4([GOVERNANCE_DOMAIN, safeId, padAscii32(action), root.field]);
}

export function createMembershipSetup(memberCount: number, safeId = randomBytes32()): MembershipSetup {
  if (!Number.isInteger(memberCount) || memberCount < 1 || memberCount > MEMBER_TREE_CAPACITY) {
    throw new Error('BLACKOUT_SAFE_INVALID_MEMBER_COUNT');
  }
  if (safeId.length !== 32) throw new Error('BLACKOUT_SAFE_SAFE_ID_MUST_BE_32_BYTES');

  const secrets = Array.from({ length: memberCount }, () => randomBytes32());
  const commitments = secrets.map(exactMemberCommitment);
  const leaves = Array.from({ length: MEMBER_TREE_CAPACITY }, (_, index) => commitments[index] ?? ZERO_32);
  const levels: bigint[][] = [leaves.map(exactLeafDigest)];

  for (let level = 0; level < MEMBER_TREE_DEPTH; level += 1) {
    const previous = levels[level];
    const next: bigint[] = [];
    for (let i = 0; i < previous.length; i += 2) next.push(exactParentDigest(previous[i], previous[i + 1]));
    levels.push(next);
  }

  const safeIdHex = bytesToHex32(safeId);
  const kits = secrets.map((secret, leafIndex): SerializedSafeSignerKit => {
    let index = leafIndex;
    const path: Array<{ sibling: Hex32String; goes_left: boolean }> = [];
    for (let level = 0; level < MEMBER_TREE_DEPTH; level += 1) {
      const siblingIndex = index ^ 1;
      path.push({
        sibling: fieldToHex32(levels[level][siblingIndex]),
        goes_left: index % 2 === 0,
      });
      index = Math.floor(index / 2);
    }
    return {
      format: 'BLACKOUT_SAFE_SIGNER_KIT_V1',
      safeId: safeIdHex,
      membershipVersion: '1',
      memberSecret: bytesToHex32(secret),
      memberCommitment: bytesToHex32(commitments[leafIndex]),
      memberPath: {
        is_some: true,
        value: {
          leaf: bytesToHex32(commitments[leafIndex]),
          path,
        },
      },
    };
  });

  const root = { field: levels[MEMBER_TREE_DEPTH][0] };
  return { safeId, root, rootHex: fieldToHex32(root.field), kits };
}

export function decodeSignerKit(kit: SerializedSafeSignerKit): {
  safeId: Uint8Array;
  membershipVersion: bigint;
  memberSecret: Uint8Array;
  memberCommitment: Uint8Array;
  memberPath: {
    is_some: true;
    value: {
      leaf: Uint8Array;
      path: Array<{ sibling: { field: bigint }; goes_left: boolean }>;
    };
  };
} {
  if (kit?.format !== 'BLACKOUT_SAFE_SIGNER_KIT_V1') throw new Error('BLACKOUT_SAFE_INVALID_SIGNER_KIT');
  if (!Array.isArray(kit.memberPath?.value?.path) || kit.memberPath.value.path.length !== MEMBER_TREE_DEPTH) {
    throw new Error('BLACKOUT_SAFE_SIGNER_PATH_DEPTH_INVALID');
  }
  const memberSecret = hex32ToBytes(kit.memberSecret);
  const expectedCommitment = exactMemberCommitment(memberSecret);
  if (bytesToHex32(expectedCommitment) !== kit.memberCommitment.toLowerCase()) {
    throw new Error('BLACKOUT_SAFE_SIGNER_KIT_COMMITMENT_MISMATCH');
  }
  return {
    safeId: hex32ToBytes(kit.safeId),
    membershipVersion: BigInt(kit.membershipVersion),
    memberSecret,
    memberCommitment: expectedCommitment,
    memberPath: {
      is_some: true,
      value: {
        leaf: hex32ToBytes(kit.memberPath.value.leaf),
        path: kit.memberPath.value.path.map((entry) => ({
          sibling: hex32ToFieldDigest(entry.sibling),
          goes_left: Boolean(entry.goes_left),
        })),
      },
    },
  };
}

export function serializePolicyOpening(safeId: Uint8Array, policy: PrivatePolicyWitness): SerializedPolicyOpening {
  return {
    format: 'BLACKOUT_SAFE_POLICY_OPENING_V1',
    safeId: bytesToHex32(safeId),
    is_private: policy.is_private,
    threshold: policy.threshold.toString(),
    max_transfer_amount: policy.max_transfer_amount.toString(),
    max_proposal_lifetime: policy.max_proposal_lifetime.toString(),
    min_execution_delay: policy.min_execution_delay.toString(),
    membership_version: policy.membership_version.toString(),
    policy_version: policy.policy_version.toString(),
    salt: bytesToHex32(policy.salt),
  };
}

export function decodePolicyOpening(opening: SerializedPolicyOpening): { safeId: Uint8Array; policy: PrivatePolicyWitness } {
  if (opening?.format !== 'BLACKOUT_SAFE_POLICY_OPENING_V1') throw new Error('BLACKOUT_SAFE_INVALID_POLICY_OPENING');
  const policy: PrivatePolicyWitness = {
    is_private: Boolean(opening.is_private),
    threshold: BigInt(opening.threshold),
    max_transfer_amount: BigInt(opening.max_transfer_amount),
    max_proposal_lifetime: BigInt(opening.max_proposal_lifetime),
    min_execution_delay: BigInt(opening.min_execution_delay),
    membership_version: BigInt(opening.membership_version),
    policy_version: BigInt(opening.policy_version),
    salt: hex32ToBytes(opening.salt),
  };
  if (policy.threshold <= 0n) throw new Error('BLACKOUT_SAFE_INVALID_POLICY_THRESHOLD');
  if (policy.is_private && bytesToHex32(policy.salt) === bytesToHex32(ZERO_32)) {
    throw new Error('BLACKOUT_SAFE_PRIVATE_POLICY_SALT_REQUIRED');
  }
  return { safeId: hex32ToBytes(opening.safeId), policy };
}

export function serializeProposalBundle(
  safeId: Uint8Array,
  proposalCommitment: Uint8Array,
  payload: PrivateProposalPayload,
): SerializedProposalBundle {
  return {
    format: 'BLACKOUT_SAFE_PROPOSAL_BUNDLE_V1',
    safeId: bytesToHex32(safeId),
    proposalCommitment: bytesToHex32(proposalCommitment),
    payload: {
      action_type: bytesToHex32(payload.action_type),
      asset: bytesToHex32(payload.asset),
      recipient: bytesToHex32(payload.recipient),
      amount: payload.amount.toString(),
      calldata_or_action: bytesToHex32(payload.calldata_or_action),
      memo_hash: bytesToHex32(payload.memo_hash),
      created_at: payload.created_at.toString(),
      expires_at: payload.expires_at.toString(),
      nonce: bytesToHex32(payload.nonce),
      salt: bytesToHex32(payload.salt),
    },
  };
}

export function decodeProposalBundle(bundle: SerializedProposalBundle): {
  safeId: Uint8Array;
  proposalCommitment: Uint8Array;
  payload: PrivateProposalPayload;
} {
  if (bundle?.format !== 'BLACKOUT_SAFE_PROPOSAL_BUNDLE_V1') throw new Error('BLACKOUT_SAFE_INVALID_PROPOSAL_BUNDLE');
  const safeId = hex32ToBytes(bundle.safeId);
  const payload: PrivateProposalPayload = {
    action_type: hex32ToBytes(bundle.payload.action_type),
    asset: hex32ToBytes(bundle.payload.asset),
    recipient: hex32ToBytes(bundle.payload.recipient),
    amount: BigInt(bundle.payload.amount),
    calldata_or_action: hex32ToBytes(bundle.payload.calldata_or_action),
    memo_hash: hex32ToBytes(bundle.payload.memo_hash),
    created_at: BigInt(bundle.payload.created_at),
    expires_at: BigInt(bundle.payload.expires_at),
    nonce: hex32ToBytes(bundle.payload.nonce),
    salt: hex32ToBytes(bundle.payload.salt),
  };
  const expected = exactProposalCommitment(safeId, payload);
  if (bytesToHex32(expected) !== bundle.proposalCommitment.toLowerCase()) {
    throw new Error('BLACKOUT_SAFE_PROPOSAL_BUNDLE_COMMITMENT_MISMATCH');
  }
  return { safeId, proposalCommitment: expected, payload };
}

export function witnessBundleForSigner(
  signerKit: SerializedSafeSignerKit,
  policyOpening?: SerializedPolicyOpening,
  proposalBundle?: SerializedProposalBundle,
  heldCoin?: { nonce: Hex32String; color: Hex32String; value: string; mt_index: string },
): BlackoutSafeEphemeralWitnessBundle {
  const signer = decodeSignerKit(signerKit);
  const bundle: BlackoutSafeEphemeralWitnessBundle = {
    memberSecret: signer.memberSecret,
    memberPath: signer.memberPath as any,
  };
  if (policyOpening) bundle.policy = decodePolicyOpening(policyOpening).policy as any;
  if (proposalBundle) bundle.privateProposal = decodeProposalBundle(proposalBundle).payload as any;
  if (heldCoin) {
    bundle.heldCoin = {
      nonce: hex32ToBytes(heldCoin.nonce),
      color: hex32ToBytes(heldCoin.color),
      value: BigInt(heldCoin.value),
      mt_index: BigInt(heldCoin.mt_index),
    } as any;
  }
  return bundle;
}

export function verifyMembershipSetup(setup: MembershipSetup): boolean {
  return setup.kits.every((kit) => {
    const decoded = decodeSignerKit(kit);
    const computed = exactContract._merkleTreePathRoot_0(decoded.memberPath.value);
    return computed.field === setup.root.field;
  });
}
