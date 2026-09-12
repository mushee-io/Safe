# BLACKOUT SAFE — Milestones 10–15

## M10 — Shielded treasury hardening

The reference treasury boundary now advertises explicit capabilities. A reference adapter can never claim LIVE, and a LIVE adapter must advertise network transaction-id support before execution begins.

If a LIVE adapter claims tx-id support but returns a successful transfer result without a network transaction id, the proposal moves to `EXECUTION_UNCERTAIN`. It cannot be retried automatically. This avoids a potential double-payment when broadcast outcome is ambiguous.

The Compact path is stronger when compiled: `sendShielded` and execution-nullifier/proposal-state updates happen in one contract transaction, so the state transition is atomic.

Recipient discovery remains an explicit constraint. Contract-to-wallet shielded output ownership and wallet discovery/ciphertext delivery are separate concerns; the current product model labels discovery `EXECUTOR_ASSISTED` until the full wallet flow is verified.

## M11 — Blackout Receipt

Canonical envelope:

```text
protocol             blackout-safe
version              1
proofSystem           REFERENCE_ONLY | MIDNIGHT
safeId                public Safe identifier
statementType         versioned statement type
statementCommitment   commitment over public statement + chosen disclosures
membershipVersion     public epoch
policyVersion         public policy epoch
publicInputs          only fields required by statement
disclosures           user-selected fields
proof                 null for reference / real proof for MIDNIGHT
```

Reference receipts provide integrity testing only. They are intentionally rejected by LIVE verification.

Compact source now includes proof-oriented circuits for:

- quorum authorized
- executed exactly once
- execution with disclosed amount
- execution with disclosed recipient

These are source-level circuits until `compactc` generates real proving/verifying material.

## M12 — Blackout Verify

`toBlackoutVerifyPayload()` produces a stable versioned transport object. `verifyBlackoutReceipt()` follows fail-closed rules:

- reference receipt + LIVE -> reject
- MIDNIGHT receipt + no proof -> reject
- MIDNIGHT receipt + no real verifier -> reject
- statement commitment mismatch -> reject before proof verification
- verifier returns invalid -> reject

A test-only verifier adapter exists only inside tests to exercise the success branch. Production has no local fake-proof fallback.

## M13 — governed membership and policy rotation

Every governance action is committed inside the private proposal payload. Execution recomputes that action commitment, preventing operation substitution after approval.

Implemented actions:

- `ROTATE_MEMBERSHIP`
- `CHANGE_POLICY`
- `PAUSE`
- `RESUME`
- `CANCEL_PROPOSAL`

Membership rotation increments `membershipVersion`, activates a new Merkle root, and rebinds the current policy commitment to the new membership epoch. Old membership material and old pending proposals fail closed.

Policy change requires exactly `currentPolicyVersion + 1` and must bind the current membership version.

## M14 — emergency controls

Pause is not an owner/admin switch. It requires the same anonymous quorum governance mechanism.

While paused:

- new treasury proposals fail
- treasury approvals fail
- treasury execution fails
- governance proposals/approvals remain possible

This allows a paused Safe to recover by quorum-approved resume, membership rotation, policy change, or cancellation without a Blackout-controlled backdoor.

## M15 — hardening

The TypeScript reference engine now uses ECMAScript runtime-private fields (`#state`, `#proposals`, nullifier sets, policy). External callers receive cloned snapshots only.

The Compact membership architecture was changed from a mutable `MerkleTree` ledger to a public `MerkleTreeDigest`. This better matches the product model: the root is public, members/paths stay private, and rotation is a single governed root replacement.

The TypeScript protocol has been modularized into governance, receipts, treasury, policy, crypto and proposal-integrity boundaries.

The Compact file remains one compile target for now. Splitting it into imported Compact libraries before the exact 0.31.1 compiler is available would create an unverified import architecture, which violates the project's fail-closed engineering rule.
