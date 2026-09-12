# BLACKOUT SAFE — Test Plan

## Executed locally in this slice
- valid member Merkle proof -> PASS
- outsider reusing valid path -> FAIL
- tampered path -> FAIL
- recipient mutation changes proposal commitment
- amount mutation changes proposal commitment
- nonce mutation changes proposal commitment
- same member/same proposal nullifier is deterministic
- same member/different proposal nullifier changes
- public proposal receipt excludes recipient/amount
- outsider proposal -> FAIL
- authorized anonymous approval -> PASS
- duplicate approval -> FAIL
- second distinct authorized member reaches 2-of-3 reference quorum
- secret/commitment mismatch -> FAIL
- stale member material after membership rotation -> FAIL
- pending proposal from old membership epoch cannot accept approval -> FAIL

## Required before claiming protocol-complete / deployment-ready
- compile `contract/blackout_safe.compact` with repository-pinned Compact 0.31.1/runtime 0.16.0.
- generate contract info/ZKIR/prover/verifier artifacts.
- run the original Blackout application `npm install`, `npm run lint`, `npm test`, and `npm run build` after Safe integration.
- add Midnight simulator/real witness tests for unauthorized membership and duplicate nullifier.
- verify private values are absent from generated public outputs and browser/network telemetry.

No blocked item should be reported as PASS.
