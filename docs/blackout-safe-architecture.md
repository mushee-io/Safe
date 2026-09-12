# BLACKOUT SAFE — Architecture (Milestones 1–5)

## Product boundary
BLACKOUT SAFE proves that a treasury action was authorized while minimizing disclosure of membership, signer identity, and proposal contents.

## Current implementation slice
This slice implements the protocol model for:
1. Safe public/private state separation.
2. Private membership via Merkle membership proofs.
3. Anonymous proposal approval.
4. Proposal-scoped nullifiers and duplicate-approval rejection.
5. Private proposal payload commitments.

Execution, shielded asset movement, recovery, membership rotation circuits, private-policy mode, selective receipts, and Blackout Verify integration remain later milestones.

## Public state
- `safe_id`: stable domain identifier.
- active membership Merkle root/tree state.
- `membership_version`: invalidates stale credentials/proposals after governance changes.
- `policy_commitment` and `policy_version`.
- `required_quorum` in STANDARD policy mode.
- proposal commitments and public lifecycle state.
- proposal-scoped approval nullifiers.
- aggregate approval count.
- paused/active state.

These values are required for consensus, replay/double-approval resistance, or public verification.

## Private local state / witnesses
- raw member secret.
- member commitment opening.
- Merkle authentication path.
- proposal payload: action, asset, recipient, amount, call/action data, memo, timestamps, nonce, salt.
- any future decryption keys or encrypted proposal distribution metadata.

None of these values should be persisted into public contract state, analytics, URLs, or logs.

## Membership model
`memberCommitment = H(domain_member, memberSecret)`.

Authorized members prove in ZK that this commitment is a leaf of the active Merkle tree. The approval path proves membership without publishing the leaf being proven.

The active authorization tree is intentionally a current-root `MerkleTree`, not a historic-root authorization check. A historic root can be useful for audit, but accepting any historic root for live authorization would allow removed/stale members to continue proving old membership.

## Anonymous approval model
`nullifier = H(domain_approval, safeId, proposalCommitment, memberSecret)`.

The nullifier is public and unique for one member/proposal pair. It prevents one member from occupying multiple quorum slots without revealing a stable public signer identifier. Because proposal commitment is in the nullifier domain, the same member receives a different nullifier on a different proposal.

## Private proposal model
Only `proposalCommitment` is public. The private payload is opened to authorized clients, which must recompute the commitment before approval.

Any mutation to recipient, amount, action, asset, dates, nonce, memo hash, or salt changes the commitment and therefore invalidates approvals bound to the old commitment.

## Fail-closed rule
Unknown proposal, wrong Safe, stale membership epoch, stale policy epoch, bad Merkle proof, member-secret mismatch, duplicate nullifier, commitment mismatch, or paused Safe must fail rather than enter a demo/success path.
