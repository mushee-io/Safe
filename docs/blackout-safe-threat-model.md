# BLACKOUT SAFE — Threat Model (Milestones 1–15)

| Threat | Mitigation | Status |
|---|---|---|
| Outsider approves | Current Merkle membership proof | Reference PASS / Compact source |
| Same signer approves twice | Proposal-scoped nullifier | PASS |
| Signer impersonates another member commitment | Secret must open commitment | PASS |
| Approval replay across proposals | Proposal commitment in nullifier domain | PASS |
| Proposal payload substitution | Full private payload commitment | PASS |
| Proposal nonce reuse | Safe-scoped nonce nullifier | PASS |
| Removed/stale member | Current root + membership version | PASS reference |
| Old proposal after membership change | Proposal epoch check | PASS reference |
| Stale/wrong policy | Policy version + commitment opening | PASS |
| Policy mode substitution | Mode included in policy commitment / explicit state check | PASS reference / Compact source |
| Hidden-policy guessing | Private policy requires non-zero salt in reference model | PASS reference |
| Threshold not reached | Execution/quorum check unique approval count | PASS |
| Amount above policy | Committed max-transfer rule | PASS |
| Excess proposal lifetime | Committed lifetime rule | PASS |
| Execute too early | Minimum execution delay | PASS reference / Compact block-time source |
| Execute expired proposal | Expiry gate | PASS reference / Compact block-time source |
| Double execution | Execution nullifier + proposal closed | PASS |
| Insufficient funds | Treasury balance / held coin value check | PASS reference / Compact source |
| Treasury dependency missing | Unavailable adapter throws; no fallback | PASS |
| LIVE adapter lacks transaction id | Capability preflight before transfer | PASS reference |
| LIVE transfer result ambiguous | `EXECUTION_UNCERTAIN`, no automatic retry | PASS reference |
| Held shielded coin leaks via public state | Witness-supplied QSCI instead of ordinary ledger storage | Compact source |
| Recipient cannot discover contract-sent shielded coin | Executor-assisted ciphertext/discovery required | OPEN — LIVE blocker |
| Receipt tampering | Statement commitment recomputation | PASS |
| Reference receipt passed as real ZK proof | LIVE rejects `REFERENCE_ONLY` | PASS |
| Proof verifier unavailable | Fail closed | PASS |
| Governance action substitution | Operation commitment in proposal | PASS |
| Unilateral pause/admin abuse | Pause/resume require quorum governance; no master key | PASS reference / Compact source |
| Pause permanently bricks Safe | Recovery governance remains enabled while paused | PASS |
| Membership rotation leaves old access valid | Root + membership epoch update | PASS reference |
| Membership rotation leaves old proposal executable | Proposal membership epoch mismatch | PASS |
| Policy update skips epochs | Require exact +1 policy version | PASS |
| Cancellation replay/invalid target | Governance commitment + pending target check | PASS |
| External JS state mutation bypasses governance | Runtime-private fields + cloned snapshots | PASS |
| Private policy threshold inference | No direct threshold field, but public approval count leaks bounds | Documented limitation |
| Private time-policy leakage | Block-time predicate boundary is public | Documented limitation |
| Frontend/log leakage | Full privacy telemetry audit later | OPEN |
