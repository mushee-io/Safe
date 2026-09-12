# BLACKOUT SAFE — Hardening Review (M10–M15)

## Fixed issues

### 1. Externally mutable reference state
**Risk:** callers could mutate Safe/proposal objects without governance.

**Fix:** runtime-private `#` fields and snapshot-only getters.

### 2. LIVE transfer ambiguity
**Risk:** a transfer could broadcast, return no tx id, and be retried.

**Fix:** LIVE adapters must declare tx-id support before transfer. An unexpected successful result without an id locks the proposal as `EXECUTION_UNCERTAIN`.

### 3. Pause could brick recovery
**Risk:** a strict global pause would prevent the proposal needed to resume or rotate compromised members.

**Fix:** pause blocks treasury activity while governance remains quorum-authorized and available.

### 4. Governance operation substitution
**Risk:** approve a generic governance proposal, execute a different action.

**Fix:** governance operation has its own commitment and must match `calldataOrAction` in the approved private proposal.

### 5. Membership-tree rotation architecture
**Risk:** mutating one Merkle tree in-place complicates atomic replacement and stale proof invalidation.

**Fix:** Compact source stores `membership_root: MerkleTreeDigest`; member paths prove against the root, and governed rotation atomically replaces root + epoch.

### 6. Policy mode was not bound in Compact policy commitment
**Risk:** changing private/public policy mode could alter disclosure semantics without changing committed policy material.

**Fix:** `is_private` is now part of `PrivatePolicyWitness` and the policy v3 commitment.

### 7. Receipt integrity vs proof validity confusion
**Risk:** a deterministic local receipt could be mistaken for a zero-knowledge proof.

**Fix:** `REFERENCE_ONLY` and `MIDNIGHT` are distinct proof-system modes. LIVE verification refuses reference-only receipts.

## Current hard blockers

- Exact Compact 0.31.1 compilation cannot be executed in this isolated runtime.
- No generated ZKIR/prover/verifier files exist for Safe receipt/governance circuits yet.
- No generated Midnight.js bindings exist for Safe yet.
- Shielded recipient discovery/ciphertext delivery has not been proven end-to-end with Lace.
- Blackout Verify has the Safe transport/verifier boundary but is not yet wired to real generated Midnight proof artifacts.

## Security posture

No admin withdrawal path, master key, fake proof verifier, demo fallback, or fake LIVE transaction path has been added.
