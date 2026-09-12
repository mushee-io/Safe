# BLACKOUT SAFE

**Zero-Knowledge Treasury Operating System for Midnight Network.**

> Prove the treasury action is authorized. Reveal nothing else that does not need to be revealed.

BLACKOUT SAFE is a confidential organizational treasury protocol built around private membership, anonymous quorum, committed policy, shielded execution, selective audit receipts and governed recovery.

## Implemented — Milestones 1–20 + final security hardening

### Confidential authorization
- private member commitments + Merkle membership proofs
- proposal-scoped anonymous approval nullifiers
- duplicate-approval rejection
- membership/policy epoch binding
- private proposal commitments
- proposal category kept out of public proposal state
- only canonical `TRANSFER` and `GOVERNANCE` actions accepted by the current contract core
- each proposal snapshots only its already-public policy commitment for durable audit proofs

### Treasury policy + execution
- STANDARD and committed PRIVATE_POLICY modes
- threshold, transfer ceiling, proposal lifetime and execution delay
- proposal nonce replay protection
- execution nullifiers / exactly-once protection
- Compact `receiveShielded` / `sendShielded` treasury circuits
- fail-closed shielded treasury adapter boundary
- ambiguous LIVE results lock the reference proposal as `EXECUTION_UNCERTAIN`

### Blackout Receipt / Verify
- versioned `blackout-safe` receipt envelope
- quorum authorization receipt
- executed-exactly-once receipt
- selective amount / recipient disclosure circuits
- historical quorum receipt opens against the proposal's original policy commitment after later policy rotation
- reference receipts are rejected by LIVE verification
- missing/unavailable real Midnight proof verification fails closed

### Governance / recovery
- quorum-governed membership rotation
- quorum-governed policy change
- quorum-governed pause / resume
- quorum-governed proposal cancellation
- paused Safe still permits recovery governance
- no Blackout master/admin withdrawal key

### Hardened Midnight LIVE boundary
- generated Compact `Contract` binding wrapped with MidnightJS
- dedicated `blackout-safe-session-v1` private-state namespace
- private-state/signing-key storage isolated per wallet session
- disposed wallet-session providers cannot be reused
- secrets remain ephemeral witness inputs; private-state/signing-key export is disabled
- Lace DApp Connector v4 Preview-only connection path
- Lace is selected by connector name/rdns; arbitrary injected-wallet fallback is forbidden
- wallet network, endpoints, account shielded keys and positive DUST are revalidated before every LIVE provider build
- non-local indexer connections require HTTPS/WSS and reject embedded URL credentials
- real `deployContract` path for Safe constructor arguments
- real `submitCallTx` path covering all 15 Safe circuits
- exact circuit-argument-count checks before wallet access
- returned tx IDs / contract address validated before being surfaced as evidence
- wallet/SDK error strings redact credentials and large serialized hex payloads
- no demo/fake LIVE fallback
- all browser ZK assets are pinned to the app's same-origin `/zk-artifacts/blackout-safe` path
- callers cannot redirect LIVE proving to an arbitrary external artifact host

### Hardened release gate
- fake deployment IDs fail closed
- 64-hex-looking IDs alone do not count as Preview deployment proof
- Preview promotion additionally requires `networkId=preview`, finalization and explicit on-chain/indexer verification
- production can never be automatically approved
- manual security/privacy review remains mandatory before any production/mainnet release

## Verification status

Final hardening branch verification target:

- reference/security regression: **36 tests**
- M10–M15 hardening: **28 tests**
- proposal privacy: **2 tests**
- M15–M20 final adversarial/integration gate: **11 tests**
- ephemeral witness boundary: **2 tests**
- final security hardening: **10 tests**
- total: **89 tests**
- strict TypeScript: **required PASS**
- Compact source compile: **required PASS**
- full ZKIR/prover/verifier generation for 15 exported circuits: **required PASS**
- generated binding integration: **required PASS in CI**

Compatibility remains pinned to:

- Compact compiler `0.31.1`
- Compact language `0.23.0`
- ledger `8.0.2`
- Compact runtime `0.16.0`
- Midnight.js `4.1.1`

See [`BUILD_STATUS.md`](./BUILD_STATUS.md), [`docs/blackout-safe-final-hardening.md`](./docs/blackout-safe-final-hardening.md), and [`docs/SECURITY_HARDENING_CHECKLIST.md`](./docs/SECURITY_HARDENING_CHECKLIST.md).

## Not claimed yet

The build remains **Preview-deployment ready**, not Preview-deployed. A real connected funded Lace Preview wallet is still required for:

- real Safe deployment transaction + contract address
- finalized deployment verified from Preview network data
- real shielded deposit
- 3+ independent wallet approval sequence
- real shielded recipient execution
- recipient output discovery/ciphertext delivery
- real Midnight proof-backed Blackout Receipt verification in Blackout Verify

No mainnet deployment is authorized by this repository.

## Layout

```text
contract/
  blackout_safe.compact
scripts/
  copy-safe-zk-artifacts.mjs
src/safe/
  crypto.ts
  governance.ts
  model.ts
  policy-engine.ts
  proposal-integrity.ts
  receipts.ts
  reference-engine.ts
  treasury.ts
  release-gate.ts
  security-hardening.test.ts
  midnight/
    compiled-safe-contract.ts
    private-state.ts
    security-hardening.ts
    witnesses.ts
    wallet-session.ts
    providers.ts
    live-safe.ts
  *.test.ts
docs/
BUILD_STATUS.md
```

## Security rule

No LIVE success fallback. No fake approval. No fake deployment. No pretend balance. No hard-coded PASS. Missing wallet/proof/private-state/treasury dependencies fail closed. Production remains manually security-gated even after complete Preview evidence.
