# BLACKOUT SAFE — BUILD STATUS

Repository: `mushee-io/Safe`

## Milestone 15 — compiler / privacy hardening

- Compact `0.31.1`: **PASS**
- language `0.23.0`: **PASS**
- ledger `8.0.2`: **PASS**
- runtime `0.16.0`: **PASS**
- 15 exported Safe circuits recognized: **PASS**
- full ZKIR/prover/verifier generation: **PASS**
- proposal category absent from public proposal state: **PASS**
- PRIVATE_POLICY threshold remains hidden: **PASS**
- canonical action tags only (`TRANSFER` / `GOVERNANCE`): **PASS**
- proposal policy-commitment snapshot for durable historical receipts: **PASS**

## Milestone 16 — generated binding + private state

- generated `Contract` wrapper: **PASS (CI typechecked)**
- MidnightJS `CompiledContract` integration: **PASS (CI typechecked)**
- dedicated `blackout-safe-session-v1` namespace: **PASS**
- raw member/proposal/policy secrets excluded from persistent private state: **PASS by architecture**
- private-state/signing-key export/import disabled: **PASS**
- ephemeral witness adapter: **PASS**
- missing witness values fail closed: **PASS**
- wallet-session scoped private-state/signing-key isolation: **PASS**
- disposed session providers permanently invalidated: **PASS**
- all 45 browser proving files staged (15 prover + 15 verifier + 15 ZKIR): **PASS in build pipeline**

## Milestone 17 — Lace Preview provider

- DApp Connector v4 `connect('preview')`: **IMPLEMENTED**
- Lace selection by connector name/rdns: **PASS**
- arbitrary injected-wallet fallback: **REMOVED**
- non-Preview session rejection: **PASS**
- session revalidation before every LIVE provider build: **PASS**
- wallet account/key mutation detection: **PASS**
- network/indexer configuration mutation detection: **PASS**
- HTTPS/WSS endpoint enforcement outside localhost: **PASS**
- credential-bearing endpoint rejection: **PASS**
- shielded coin/encryption keys required: **PASS**
- wallet-delegated proving required: **PASS**
- transaction balance/submit capabilities required: **PASS**
- real positive DUST required: **PASS**
- demo LIVE fallback: **NONE**
- real browser Lace session: **NOT YET EXERCISED IN THIS REPO**

## Milestone 18 — Preview deploy/call orchestration

- real `deployContract` integration: **IMPLEMENTED / TYPECHECK PASS**
- constructor args wired through MidnightJS `args`: **IMPLEMENTED**
- real `submitCallTx` integration: **IMPLEMENTED / TYPECHECK PASS**
- all 15 circuit IDs exposed: **PASS**
- exact circuit argument-count gate: **PASS**
- invalid contract address rejected before network call: **PASS**
- returned deploy/call tx IDs validated before evidence is surfaced: **PASS**
- same-origin ZK artifact path pinned to `/zk-artifacts/blackout-safe`: **PASS**
- caller-controlled LIVE ZK artifact host: **REMOVED**
- sensitive wallet/SDK error payload redaction: **PASS**
- PRIVATE_POLICY public threshold leakage rejected before wallet call: **PASS**
- real Preview deployment tx: **NOT ATTEMPTED**
- real Preview contract address: **NONE YET**

## Milestone 19 — multi-user / adversarial final harness

Reference harness:

- five authorized members: **PASS**
- 3-of-5 threshold: **PASS**
- two approvals remain below quorum: **PASS**
- third distinct authorized approval reaches quorum: **PASS**
- outsider approval: **BLOCKED / PASS**
- duplicate approval: **BLOCKED / PASS**
- unsupported proposal action: **BLOCKED / PASS**
- historical quorum remains provable against original policy snapshot: **PASS**

Real multi-wallet Preview run: **NOT YET PERFORMED**.

## Milestone 20 — release gate

- fake deployment IDs rejected: **PASS**
- 64-hex-looking IDs alone are insufficient: **PASS**
- finalized Preview network evidence required: **PASS**
- explicit on-chain/indexer deployment verification required: **PASS**
- compiler/tests/integration evidence required before Preview deploy: **PASS**
- missing Preview evidence remains explicit blocker: **PASS**
- production cannot be auto-approved: **PASS**
- manual security/privacy review remains mandatory: **PASS**

## Verification

Final hardening verification target on this branch:

- M1–10 regression/security: **36 tests**
- M10–15 hardening: **28 tests**
- proposal privacy: **2 tests**
- M15–20 final tests: **11 tests**
- ephemeral witness tests: **2 tests**
- final security hardening: **10 tests**
- **TOTAL: 89 tests**
- strict TypeScript: **required PASS**
- generated Safe binding TypeScript integration: **required PASS**
- full Compact ZK artifact generation: **required PASS**

The exact branch head is not eligible for `main` until CI verifies all 89 tests, strict TypeScript, the 15-circuit full ZK build, browser artifact staging and generated artifact upload.

## Current release stage

**PREVIEW READY — NOT PREVIEW DEPLOYED.**

The code can be connected to a funded Lace Preview wallet for the first real Safe deployment only after the final hardening CI is green. Do not mark deployment, shielded transfer, multi-wallet network quorum or live receipt verification as PASS until real finalized network evidence exists.

## Remaining blockers before a complete Preview demo

- connected funded Lace Preview wallet.
- real Safe deploy transaction and contract address.
- finalized deployment independently verified against Preview network data.
- real shielded deposit into the Safe.
- at least three independent Preview wallet approvals for one proposal.
- real shielded execution to the committed recipient.
- recipient shielded-output discovery/ciphertext delivery.
- proof-backed Blackout Receipt verification through Blackout Verify.
- BLACKOUT SAFE frontend workspace integration.

## Production blocker

Even after the Preview demo is green, production/mainnet remains blocked on a deliberate manual security/privacy review. No mainnet deployment is authorized.
