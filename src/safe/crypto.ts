import type { Hex32, MerkleProof, PrivateProposalPayload, StandardPolicy } from './model.ts';

const encoder = new TextEncoder();
const HEX32 = /^0x[0-9a-f]{64}$/;

function bytesToHex(bytes: Uint8Array): Hex32 {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function assertHex32(value: string, label = 'value'): asserts value is Hex32 {
  if (!HEX32.test(value)) throw new Error(`${label} must be a canonical lowercase 32-byte hex value`);
}

export async function sha256Utf8(value: string): Promise<Hex32> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Local/reference-domain hash. The Compact contract uses persistentHash with
 * the same domain-separation intent. This SHA-256 helper is NOT presented as a
 * byte-for-byte implementation of Compact persistentHash serialization.
 */
export async function domainHash(domain: string, ...parts: Array<string | bigint | number>): Promise<Hex32> {
  const framed = [domain, ...parts.map(String)]
    .map((part) => `${encoder.encode(part).byteLength}:${part}`)
    .join('|');
  return sha256Utf8(framed);
}

export async function deriveMemberCommitment(memberSecret: Hex32): Promise<Hex32> {
  assertHex32(memberSecret, 'memberSecret');
  return domainHash('blackout:safe:member:v1', memberSecret);
}

export async function computeProposalNullifier(
  safeId: Hex32,
  proposalCommitment: Hex32,
  memberSecret: Hex32,
): Promise<Hex32> {
  assertHex32(safeId, 'safeId');
  assertHex32(proposalCommitment, 'proposalCommitment');
  assertHex32(memberSecret, 'memberSecret');
  return domainHash('blackout:safe:approval-nullifier:v1', safeId, proposalCommitment, memberSecret);
}

export async function computePolicyCommitment(policy: StandardPolicy): Promise<Hex32> {
  if (!Number.isInteger(policy.threshold) || policy.threshold < 1) {
    throw new Error('threshold must be a positive integer');
  }
  return domainHash(
    'blackout:safe:policy:standard:v1',
    policy.threshold,
    policy.membershipVersion,
    policy.policyVersion,
  );
}

export async function computeProposalCommitment(payload: PrivateProposalPayload): Promise<Hex32> {
  assertHex32(payload.safeId, 'safeId');
  assertHex32(payload.asset, 'asset');
  assertHex32(payload.recipient, 'recipient');
  assertHex32(payload.calldataOrAction, 'calldataOrAction');
  assertHex32(payload.memoHash, 'memoHash');
  assertHex32(payload.nonce, 'nonce');
  assertHex32(payload.salt, 'salt');
  if (payload.amount < 0n) throw new Error('amount cannot be negative');
  if (payload.expiresAt <= payload.createdAt) throw new Error('proposal expiry must be after creation');

  return domainHash(
    'blackout:safe:proposal:v1',
    payload.safeId,
    payload.actionType,
    payload.asset,
    payload.recipient,
    payload.amount,
    payload.calldataOrAction,
    payload.memoHash,
    payload.createdAt,
    payload.expiresAt,
    payload.nonce,
    payload.salt,
  );
}

const EMPTY_LEAF = await domainHash('blackout:safe:merkle:empty:v1');

async function leafHash(leaf: Hex32): Promise<Hex32> {
  assertHex32(leaf, 'leaf');
  return domainHash('blackout:safe:merkle:leaf:v1', leaf);
}

async function nodeHash(left: Hex32, right: Hex32): Promise<Hex32> {
  return domainHash('blackout:safe:merkle:node:v1', left, right);
}

export interface MerkleSnapshot {
  root: Hex32;
  depth: number;
  leaves: Hex32[];
  proofs: MerkleProof[];
}

/** Builds a fixed-depth reference tree for membership/protocol tests. */
export async function buildMembershipTree(leaves: Hex32[], depth = 4): Promise<MerkleSnapshot> {
  if (!Number.isInteger(depth) || depth < 2 || depth > 20) throw new Error('invalid test Merkle depth');
  const capacity = 2 ** depth;
  if (leaves.length === 0) throw new Error('at least one member is required');
  if (leaves.length > capacity) throw new Error('membership tree capacity exceeded');
  leaves.forEach((leaf, i) => assertHex32(leaf, `leaves[${i}]`));
  if (new Set(leaves).size !== leaves.length) throw new Error('duplicate member commitment');

  const padded: Hex32[] = [...leaves];
  while (padded.length < capacity) padded.push(EMPTY_LEAF);

  const levels: Hex32[][] = [await Promise.all(padded.map(leafHash))];
  for (let level = 0; level < depth; level += 1) {
    const previous = levels[level];
    const next: Hex32[] = [];
    for (let i = 0; i < previous.length; i += 2) {
      next.push(await nodeHash(previous[i], previous[i + 1]));
    }
    levels.push(next);
  }

  const proofs: MerkleProof[] = leaves.map((_, leafIndex) => {
    let index = leafIndex;
    const siblings: Hex32[] = [];
    const siblingOnLeft: boolean[] = [];
    for (let level = 0; level < depth; level += 1) {
      const siblingIndex = index ^ 1;
      siblings.push(levels[level][siblingIndex]);
      siblingOnLeft.push(siblingIndex < index);
      index = Math.floor(index / 2);
    }
    return { leafIndex, siblings, siblingOnLeft };
  });

  return { root: levels[depth][0], depth, leaves: [...leaves], proofs };
}

export async function verifyMembershipProof(
  memberCommitment: Hex32,
  proof: MerkleProof,
  expectedRoot: Hex32,
): Promise<boolean> {
  assertHex32(memberCommitment, 'memberCommitment');
  assertHex32(expectedRoot, 'expectedRoot');
  if (proof.siblings.length !== proof.siblingOnLeft.length || proof.siblings.length < 2) return false;

  let current = await leafHash(memberCommitment);
  for (let i = 0; i < proof.siblings.length; i += 1) {
    const sibling = proof.siblings[i];
    assertHex32(sibling, `proof.siblings[${i}]`);
    current = proof.siblingOnLeft[i]
      ? await nodeHash(sibling, current)
      : await nodeHash(current, sibling);
  }
  return current === expectedRoot;
}
