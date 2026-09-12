# BLACKOUT SAFE

**Zero-Knowledge Treasury Operating System for Midnight Network.**

> Prove the treasury action is authorized. Reveal nothing else that does not need to be revealed.

BLACKOUT SAFE is not a dark-mode clone of Safe/Gnosis. It is a confidential treasury protocol whose authorization, policy and execution rules are designed around Midnight zero-knowledge and shielded-token primitives.

## Implemented protocol slice — Milestones 1–10

- private membership commitments and Merkle proofs
- anonymous signer authorization
- proposal-scoped nullifiers
- private proposal commitments
- stale membership/policy epoch rejection
- programmable policy baseline: threshold, transfer ceiling, proposal lifetime, execution delay
- explicit zero-identity quorum statement
- `STANDARD` policy mode
- `PRIVATE_POLICY` committed threshold/limits mode
- proposal nonce replay protection
- execution nullifiers and double-execution protection
- policy/expiry/delay/quorum execution state machine
- fail-closed shielded treasury adapter boundary
- Compact shielded custody source using `receiveShielded`, witness-supplied `QualifiedShieldedCoinInfo`, and `sendShielded`

## Verification status

Protocol/security reference suites: **36 PASS / 0 FAIL** total — 19 Milestones 1–5 tests plus 17 Milestones 6–10 tests.

Strict TypeScript typecheck: **PASS**.

Compact source: **NOT YET COMPILE-VERIFIED** in this isolated build runtime. Generated Safe ZK assets and real Preview/Lace shielded treasury transactions are not claimed complete.

See [`BUILD_STATUS.md`](./BUILD_STATUS.md) and [`docs/blackout-safe-milestones-6-10.md`](./docs/blackout-safe-milestones-6-10.md).

## Local reference tests

Requires Node.js 22+ and TypeScript 5.8+.

```bash
npm install
npm test
npm run typecheck
```

## Layout

```text
contract/blackout_safe.compact
src/safe/
  crypto.ts
  model.ts
  policy-engine.ts
  proposal-integrity.ts
  reference-engine.ts
  treasury.ts
  blackout-safe.test.ts
  milestones-6-10.test.ts
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
