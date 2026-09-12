# BLACKOUT SAFE

**Zero-Knowledge Treasury Operating System for Midnight Network.**

> Prove the treasury action is authorized. Reveal nothing else that does not need to be revealed.

BLACKOUT SAFE is a confidential organizational treasury protocol built around private membership, anonymous quorum, committed policy, shielded execution, selective audit receipts and governed recovery.

## Implemented — Milestones 1–20 protocol/integration slice

### Confidential authorization
- private member commitments + Merkle membership proofs
- proposal-scoped anonymous approval nullifiers
- duplicate-approval rejection
- membership/policy epoch binding
- private proposal commitments
- proposal category kept out of public proposal state

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
- reference receipts are rejected by LIVE verification
- missing/unavailable real Midnight proof verification fails closed

### Governance / recovery
- quorum-governed membership rotation
- quorum-governed policy change
- quorum-governed pause / resume
- quorum-governed proposal cancellation
- paused Safe still permits recovery governance
- no Blackout master/admin withdrawal key

### Real Midnight integration boundary
- generated Compact `Contract` binding wrapped with MidnightJS
- dedicated `blackout-safe-session-v1` private-state namespace
- secrets remain ephemeral witness inputs; private-state/signing-key export is disabled
- ephemeral witness-bundle adapter for member secret/path, proposal, policy, next policy and held coin
- Lace DApp Connector v4 Preview-only connection path
- Preview indexer, shielded keys, wallet proving, balancing, submission and positive DUST are mandatory
- real `deployContract` path for Safe constructor arguments
- real `submitCallTx` path covering all 15 Safe circuits
- no demo/fake LIVE fallback
- browser ZK artifact staging for every prover/verifier/ZKIR file

## Verification status

- reference/security regression: **36 PASS / 0 FAIL**
- M10–M15 hardening: **28 PASS / 0 FAIL**
- proposal privacy: **2 PASS / 0 FAIL**
- M15–M20 final adversarial/integration gate: **10 PASS / 0 FAIL**
- ephemeral witness boundary: **2 PASS / 0 FAIL**
- total: **78 PASS / 0 FAIL**
- strict TypeScript: **PASS**
- Compact source compile: **PASS**
- full ZKIR/prover/verifier generation for 15 exported circuits: **PASS**
- generated binding integration: **PASS in CI**

Compatibility verified against:

- Compact compiler `0.31.1`
- Compact language `0.23.0`
- ledger `8.0.2`
- Compact runtime `0.16.0`
- Midnight.js `4.1.1`

## Not claimed yet

The build is **Preview-deployment ready**, not Preview-deployed. A real connected funded Lace Preview wallet is still required for:

- real Safe deployment transaction + contract address
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
  midnight/
    compiled-safe-contract.ts
    private-state.ts
    witnesses.ts
    wallet-session.ts
    providers.ts
    live-safe.ts
  *.test.ts
docs/
BUILD_STATUS.md
```

## Security rule

No LIVE success fallback. No fake approval. No fake deployment. No pretend balance. No hard-coded PASS. Missing wallet/proof/private-state/treasury dependencies fail closed. Production remains manually security-gated even after Preview evidence is complete.
