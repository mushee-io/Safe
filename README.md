# BLACKOUT SAFE

**Zero-Knowledge Treasury Operating System for Midnight Network.**

> Prove the treasury action is authorized. Reveal nothing else that does not need to be revealed.

This repository contains the Milestones 1–5 protocol core for BLACKOUT SAFE:

- private membership commitments and Merkle membership proofs
- anonymous signer authorization model
- proposal-scoped nullifiers and duplicate-approval protection
- private proposal commitments and client-side integrity verification
- current-membership epoch binding to reject stale member proofs
- 2-of-3 quorum reference engine and fail-closed proposal transport abstraction
- Midnight Compact contract draft targeting the existing Blackout compatibility stack
- architecture, privacy, threat-model, audit, and test documentation

## Status

Local reference protocol tests: **19 PASS / 0 FAIL**.

The Compact source has **not yet been compiled in the isolated build environment**, because the existing Blackout repository's pinned `bin/compact` could not be materialized there. Generated Safe ZK artifacts, Lace Safe transactions, and Midnight Preview deployment are therefore not claimed as complete.

See [`BUILD_STATUS.md`](./BUILD_STATUS.md) for the exact truth table.

## Local reference tests

Requires Node.js 22+.

```bash
npm install
npm test
npm run typecheck
```

The test runner uses Node's TypeScript type-stripping support for the dependency-free protocol reference core.

## Layout

```text
contract/blackout_safe.compact
src/safe/
docs/
BUILD_STATUS.md
```

## Compatibility target

The active Blackout application path inspected during the audit uses:

- Compact compiler: `0.31.1`
- Compact language: `0.23.0`
- Compact runtime: `0.16.0`
- Midnight.js: `4.1.1`

A separate stale/duplicate artifact path reports newer versions. BLACKOUT SAFE deliberately targets the active Blackout path until the whole application is upgraded and rebuilt together.

## Security rule

No LIVE success fallback. No fake approvals. No fake deployment. No hardcoded PASS. Any unavailable cryptographic or network dependency must fail closed.
