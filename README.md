# BLACKOUT SAFE

**Zero-Knowledge Treasury Operating System for Midnight Network.**

> Prove the treasury action is authorized. Reveal nothing else that does not need to be revealed.

BLACKOUT SAFE is not a dark-mode clone of Safe/Gnosis. It is a confidential treasury protocol whose authorization, policy, recovery and execution rules are designed around Midnight zero-knowledge and shielded-token primitives.

## Implemented protocol slice — Milestones 1–15

### Private authorization
- private member commitments + Merkle membership proofs
- proposal-scoped anonymous approval nullifiers
- duplicate-approval rejection
- current membership/policy epoch binding
- private proposal commitments

### Treasury policy + execution
- threshold policy
- transfer ceiling
- proposal lifetime
- mandatory execution delay
- `STANDARD` and committed `PRIVATE_POLICY` modes
- proposal nonce replay protection
- execution nullifiers
- double-execution protection
- fail-closed shielded treasury adapter boundary
- Compact shielded custody source using `receiveShielded` / `sendShielded`
- LIVE adapter tx-id capability checks
- `EXECUTION_UNCERTAIN` lockout for ambiguous external LIVE outcomes

### Blackout Receipt / Verify
- versioned `blackout-safe` receipt envelope
- quorum receipt
- executed-exactly-once receipt
- selective amount disclosure
- selective recipient disclosure
- receipt statement commitments
- reference-only receipts cannot pass LIVE verification
- missing/unavailable Midnight proof verification fails closed
- Blackout Verify transport payload

### Governance / recovery
- quorum-governed membership root rotation
- quorum-governed policy change
- pause
- resume
- proposal cancellation
- paused Safe still permits recovery governance
- membership rotation invalidates old-epoch proposals/credentials
- policy change invalidates old-policy proposals
- no Blackout master/admin withdrawal key

### Hardening
- protocol state uses runtime-private `#` fields in the TypeScript reference engine
- external Safe/proposal state is snapshot-only
- governance operations are committed into the private proposal payload
- operation substitution fails
- LIVE/reference treasury capabilities are explicitly separated
- Compact membership model changed to a public Merkle root digest for atomic governed rotation

## Verification status

TypeScript/reference protocol:

- regression/security tests: **36 PASS / 0 FAIL**
- M10–M15 hardening tests: **28 PASS / 0 FAIL**
- total: **64 PASS / 0 FAIL**
- strict TypeScript typecheck: **PASS**

Compact source: **IMPLEMENTED THROUGH M15, NOT YET COMPILE-VERIFIED** in this isolated runtime. Generated Safe ZK assets, real Midnight proof receipts, Lace/Preview contract deployment and recipient ciphertext delivery are not claimed complete.

See [`BUILD_STATUS.md`](./BUILD_STATUS.md), [`docs/blackout-safe-milestones-10-15.md`](./docs/blackout-safe-milestones-10-15.md), and [`docs/blackout-safe-hardening-review.md`](./docs/blackout-safe-hardening-review.md).

## Local tests

Requires Node.js 22+ and TypeScript 5.8+.

```bash
npm install
npm test
npm run typecheck
```

## Layout

```text
contract/
  blackout_safe.compact
src/safe/
  crypto.ts
  governance.ts
  model.ts
  policy-engine.ts
  proposal-integrity.ts
  receipts.ts
  reference-engine.ts
  treasury.ts
  blackout-safe.test.ts
  milestones-10-15.test.ts
docs/
BUILD_STATUS.md
```

## Compatibility target

The active Blackout stack audited before starting Safe uses:

- Compact compiler `0.31.1`
- Compact language `0.23.0`
- Compact runtime `0.16.0`
- Midnight.js `4.1.1`

## Security rule

No LIVE success fallback. No fake approval. No fake deployment. No pretend balance. No hard-coded PASS. Missing wallet/proof/private-state/treasury dependencies must fail closed.
