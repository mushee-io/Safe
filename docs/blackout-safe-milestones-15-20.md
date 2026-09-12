# BLACKOUT SAFE — Milestones 15–20

This is the final protocol/integration build slice before a real Midnight Preview deployment and multi-wallet exercise.

## M15 — Compiler / privacy hardening

Status: **PASS**

- `blackout_safe.compact` compiles with Compact `0.31.1` / language `0.23.0` / ledger `8.0.2` / runtime `0.16.0`.
- Full ZK generation has produced contract bindings, ZKIR, prover keys and verifier keys for all 15 exported circuits.
- Public proposal state does not expose TREASURY vs GOVERNANCE category.
- PRIVATE_POLICY threshold remains hidden.
- bounded approval/membership/policy counters are compiler-checked.
- no unilateral admin/master-key treasury transition exists.

## M16 — Generated Safe binding + artifact pipeline

Status: **IMPLEMENTED / CI-VERIFIED BINDING INTEGRATION**

- `src/safe/midnight/compiled-safe-contract.ts` wraps the compiler-generated `Contract` class.
- Safe uses a dedicated `blackout-safe-session-v1` private-state namespace.
- private state is intentionally empty; member secrets, Merkle paths, proposal openings, policy openings and held coins remain ephemeral witness inputs.
- private-state/signing-key export/import is disabled.
- browser artifact staging copies every prover/verifier/ZKIR file to `/zk-artifacts/blackout-safe` and fails closed if any artifact is missing.
- CI generates bindings before TypeScript checks and uploads the full generated artifact set as a workflow artifact.

## M17 — Lace Preview provider

Status: **IMPLEMENTED / REAL-WALLET TEST PENDING**

- detects injected Midnight wallets and prefers Lace.
- uses DApp Connector v4 `connect('preview')` only.
- rejects non-Preview sessions.
- requires Preview indexer HTTP + WebSocket endpoints.
- requires shielded coin/encryption keys.
- requires wallet-delegated proving, transaction balancing and submission.
- requires a real positive DUST balance.
- no demo wallet or fake balance fallback exists in the LIVE module.

## M18 — LIVE deploy/call path

Status: **IMPLEMENTED / PREVIEW TRANSACTION PENDING**

- real `deployContract` path using generated Safe contract.
- constructor args are passed through MidnightJS `args`.
- real `submitCallTx` path supports all 15 Safe circuits.
- invalid contract addresses fail before provider/network access.
- PRIVATE_POLICY deployment rejects any public threshold leakage before wallet access.
- tx ID / block height are returned only from MidnightJS transaction results.

A real Preview deployment is not claimed until a connected funded Lace Preview wallet returns a real deployment transaction ID and contract address.

## M19 — Multi-user / adversarial final harness

Status: **REFERENCE PASS / PREVIEW MULTI-WALLET PENDING**

The final harness includes a five-member 3-of-5 treasury and verifies:

- quorum does not pass at two approvals.
- three distinct authorized approvals satisfy quorum.
- outsider approval fails.
- duplicate approval fails.
- wallet prerequisites fail closed.
- private-state export remains disabled.

This is not represented as a multi-wallet Preview transaction run. That requires three or more real Preview wallet sessions.

## M20 — Release gate

Status: **PASS (FAIL-CLOSED)**

The release gate requires all build/compiler/integration evidence before opening Preview deployment. It refuses fake/non-chain deployment identifiers and never auto-approves production.

Even after all Preview evidence is supplied, production remains blocked on an explicit manual security/privacy review.

## Remaining LIVE blockers

- real Midnight Preview Safe deployment transaction.
- real contract address returned from that deployment.
- real shielded Safe deposit with Lace.
- three-wallet Preview approval/quorum transaction sequence.
- real shielded execution to a recipient.
- end-to-end recipient shielded-output discovery/ciphertext delivery.
- real Midnight proof-backed Blackout Receipt verification inside Blackout Verify.
- frontend BLACKOUT SAFE workspace integration.

No mainnet deployment is authorized by this build.
