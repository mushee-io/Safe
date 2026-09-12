# BLACKOUT SAFE — Milestones 6–10

This document records the implementation slice for programmable policy, quorum proof, threshold privacy, execution, and shielded treasury custody.

## Milestone 6 — Treasury policy engine

Implemented policy rules:
- approval threshold
- maximum per-transfer amount
- maximum proposal lifetime
- minimum execution delay
- membership version binding
- policy version binding
- domain-separated policy commitment

`STANDARD` mode intentionally exposes the threshold in public Safe state.

`PRIVATE_POLICY` stores only the policy commitment publicly. Threshold and amount/lifetime/delay parameters are supplied as private policy witness material and must open the commitment before they can authorize proposal creation, quorum proof, or execution.

Extension points intentionally left for later governance work:
- rolling daily/weekly/monthly spend windows
- role credentials
- approved asset Merkle roots
- approved recipient Merkle roots
- transaction velocity limits
- emergency policy overrides

Those are not claimed as implemented yet.

## Milestone 7 — Quorum proof

Each approval still requires:
1. current membership proof;
2. proposal-bound nullifier;
3. unused nullifier;
4. current membership and policy epochs.

The protocol exposes a separate `prove_quorum` statement instead of publishing quorum status on every approval. This matters for `PRIVATE_POLICY`: an approval receipt does not publish whether the hidden threshold has just been reached.

Public statement:

`QUORUM_AUTHORIZED = true`

The statement does not contain member secrets, member commitments, or signer identities.

## Milestone 8 — Threshold privacy

### STANDARD
- threshold public;
- policy commitment public;
- signer identities private;
- approval nullifiers public;
- aggregate approval count public.

### PRIVATE_POLICY
- threshold omitted from public Safe state;
- approval receipt returns no quorum progression flag;
- private policy opening is checked against `policy_commitment`;
- execution proves the hidden policy's threshold/limits were satisfied.

### Important inference limitation

The aggregate approval count remains public in this architecture. Successful execution or an explicit quorum proof therefore lets an observer infer a bound on the hidden threshold. BLACKOUT SAFE does not claim information-theoretic threshold secrecy. Hiding approval count as well would require a different aggregated-proof/tally architecture.

### Time-policy limitation

Compact's block-time predicates accept a public `Uint<64>` boundary. The contract can cryptographically enforce expiry and minimum delay, but the exact time boundary passed into the block-time check is disclosed at execution. PRIVATE_POLICY therefore hides threshold/amount limits better than it hides time boundaries in the current design.

## Milestone 9 — Execution state machine

Reference execution requires:
- Safe active;
- known pending proposal;
- current membership version;
- current policy version;
- exact private payload commitment match;
- supported action type;
- policy opening match;
- policy-compliant amount/lifetime;
- minimum execution delay satisfied;
- proposal not expired;
- unique approvals at or above threshold;
- proposal nonce previously registered;
- execution nullifier unused;
- sufficient shielded treasury funds.

State mutation happens only after the treasury transfer succeeds. Successful execution:
- consumes execution nullifier;
- marks proposal executed;
- prevents another execution;
- emits only a privacy-safe execution receipt in the reference layer.

A proposal nonce is also hashed into a Safe-scoped public nonce nullifier at proposal creation so the same raw nonce cannot be reused for a different proposal.

## Milestone 10 — Shielded treasury boundary

The Compact draft now uses Midnight's shielded-token contract primitives:
- `receiveShielded` for deposits into contract custody;
- `QualifiedShieldedCoinInfo` as private witness-supplied held coin material;
- `sendShielded` for contract-to-user shielded execution;
- shielded change returned to the executing client for private persistence.

The contract does NOT publish held coin openings in ordinary ledger state.

### Private coin state requirement

Contract custody introduces a real application requirement: authorized Safe clients need access to the private opening for held shielded coins. The current source defines that as the `held_coin(color)` witness boundary. Production still needs a secure encrypted shared/private state mechanism for authorized members and change-coin persistence.

### Recipient discovery requirement

A Compact contract can route a shielded output to a recipient coin public key, but recipient wallet discovery/ciphertext delivery requires client/runtime handling. The current execution circuit deliberately returns only Safe change, not the recipient coin. Production must implement the encrypted inbox/executor-attached discovery path and test it end-to-end before marking shielded treasury LIVE.

## Current verification

Standalone TypeScript strict typecheck: PASS.

Protocol/security reference suites: 36 PASS / 0 FAIL total (19 M1–5 + 17 M6–10).

Compact compilation: NOT YET VERIFIED in this environment.

Generated Safe ZKIR/prover/verifier assets: NOT YET GENERATED.

Real Lace + Preview shielded deposit/execute: NOT YET TESTED.
