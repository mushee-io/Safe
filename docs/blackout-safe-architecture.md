# BLACKOUT SAFE — Architecture (Milestones 1–10)

## Product boundary
BLACKOUT SAFE proves that a treasury action was authorized and policy-compliant while minimizing disclosure of membership, signer identity, proposal contents, and treasury metadata.

## Implemented reference slice
1. Safe public/private state separation.
2. Private membership via Merkle membership proofs.
3. Anonymous proposal approval.
4. Proposal-scoped nullifiers and duplicate-approval rejection.
5. Private proposal payload commitments.
6. Committed programmable policy baseline.
7. Explicit zero-identity quorum statement.
8. STANDARD and PRIVATE_POLICY threshold modes.
9. Replay-safe execution state machine.
10. Shielded contract-custody boundary using Midnight token primitives in the Compact draft.

Recovery, governed membership/policy rotation circuits, selective BLACKOUT RECEIPTS, Blackout Verify integration, full frontend, encrypted multi-member private-state synchronization, generated Safe proving assets, and real Preview deployment remain later milestones.

## Public state
- `safe_id`.
- active membership Merkle root/tree state.
- `membership_version`.
- `policy_commitment` and `policy_version`.
- `policy_is_private`.
- STANDARD threshold only; PRIVATE_POLICY stores zero instead of the threshold.
- proposal commitments and lifecycle state.
- proposal-scoped approval nullifiers.
- Safe-scoped proposal nonce nullifiers.
- execution nullifiers.
- aggregate approval count.
- paused/active state.

These values are required for consensus, replay/double-approval resistance, state-machine enforcement, or public verification.

## Private local state / witnesses
- raw member secret.
- member commitment opening.
- Merkle authentication path.
- private policy opening and salt.
- proposal payload: action, asset, recipient, amount, call/action data, memo, timestamps, nonce, salt.
- qualified held shielded coin openings.
- future decryption keys/encrypted proposal and treasury-state distribution metadata.

None of these values should be persisted into normal public contract state, analytics, URLs, or logs.

## Membership model
`memberCommitment = H(domain_member, memberSecret)`.

Authorized members prove that this commitment belongs to the active Merkle tree without publishing a stable signer identity.

The live authorization structure is current-root, not historic-root. Historic roots may be retained separately for audit later, but old roots are not accepted for current authorization.

## Anonymous approval model
`approvalNullifier = H(domain_approval, safeId, proposalCommitment, memberSecret)`.

The same signer cannot occupy two quorum slots for one proposal. Different proposals produce different nullifiers.

## Proposal model
Only `proposalCommitment` is public. Authorized clients must recompute the commitment after decrypting a proposal before approving or executing it.

A separate Safe-scoped nonce nullifier prevents the same proposal nonce from being reused under another payload.

## Policy model
`policyCommitment` binds threshold, amount ceiling, proposal lifetime ceiling, execution delay, membership version, policy version, and policy salt.

STANDARD exposes threshold intentionally.

PRIVATE_POLICY omits threshold from public state and suppresses per-approval quorum progression. The committed policy opening is checked inside authorization/execution logic.

## Execution model
Execution is a state transition over the already-approved commitment. The private payload is reopened and must exactly match that commitment. The policy is reopened and must exactly match `policyCommitment`. Quorum, time bounds, replay nullifiers, and treasury funds are checked before execution.

Successful execution consumes an execution nullifier and closes the proposal. Failed execution must not create a successful state transition.

## Shielded custody
The Compact draft follows the contract-custody pattern with `receiveShielded`, a private `QualifiedShieldedCoinInfo` witness, and `sendShielded`. The Safe's raw coin opening is not stored in normal public ledger fields.

This requires production-grade private coin-state distribution and recipient discovery. Those pieces are explicitly not treated as complete yet.

## Fail-closed rule
Unknown proposal, wrong Safe, stale epoch, bad Merkle proof, member-secret mismatch, duplicate approval, reused proposal nonce, policy mismatch, policy violation, insufficient quorum, early/expired execution, insufficient shielded funds, reused execution nullifier, commitment mismatch, missing LIVE treasury dependency, or paused Safe must fail rather than enter a demo/success path.
