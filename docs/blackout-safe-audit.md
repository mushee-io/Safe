# BLACKOUT SAFE — Existing Blackout Repository Audit

Repository inspected read-only: `mushee-io/Balckout-Pay` (`main`). No branch, commit, PR, or push was created.

## Frontend
- Vite 6 + React 19 + TypeScript.
- Tailwind/Vite styling and Blackout dark editorial / Swiss-industrial UI.
- Main navigation already includes HOME, VERIFY, REQUEST, LEDGER, BLACKOUT PAYROLL, DEVELOPERS.
- Blackout Payroll is a separate `src/payroll` surface.

## Midnight dependency stack
`package.json` pins:
- `@midnight-ntwrk/compact-runtime` 0.16.0
- Midnight.js packages 4.1.1
- DApp Connector API 4.0.1

## Canonical generated artifacts used by LIVE application
The browser compiled-contract wrapper imports from `contract/build/contract/index.js`, and the Vercel artifact staging script copies proving material from `contract/build` into `/public/keys` and `/public/zkir`.

`contract/build/compiler/contract-info.json` reports:
- compiler 0.31.1
- language 0.23.0
- runtime 0.16.0

Therefore this is the canonical Safe compatibility target until the repository deliberately recompiles/upgrades everything together.

## Stale duplicate artifacts / metadata
`src/midnight/contract-artifacts/compiler/contract-manifest.json` reports compiler 0.34.0 / language 0.26.0 / runtime 0.19.0, and `MIDNIGHT_TOOLCHAIN_AUDIT.md` also describes the newer stack. These disagree with the actual active `contract/build` artifacts and installed runtime.

The old deployment orchestrator additionally prints `Compact v0.34.0` and contains a final status table with hard-coded PASS/LIVE/DEPLOYED values. BLACKOUT SAFE must not inherit that reporting behavior. Its diagnostic state must be derived from real checks.

## Wallet and provider architecture
- LIVE path discovers injected Midnight wallets and prefers Lace.
- DApp Connector v4 `connect(networkId)` is used where available.
- wallet configuration supplies indexer/prover details.
- wallet-delegated proving is used in the active browser path.
- transaction balancing and submission are delegated to the connected wallet.
- LIVE mode throws on missing wallet, wrong network, missing DUST, missing provider capabilities, or transaction failure.

## Existing private state design
The current income verifier does not persist raw income witnesses. Its Midnight private-state provider stores an empty contract-scoped object; income/salt are supplied only through witness callbacks. BLACKOUT SAFE will require richer local private state (member secret material, Merkle path material, encrypted proposal metadata), so a dedicated private-state ID/provider is required rather than reusing the income-verifier state ID.

## Environment configuration
`.env.example` intentionally leaves Midnight network/node/indexer/proof-server endpoints blank and says they should come from the connected wallet configuration. This fail-closed principle should be retained for Safe.

## Baseline limitation in this local build session
The connected GitHub integration can read repository files, but this isolated runtime cannot clone/download the full repository or its binary `bin/compact`. As a result:
- repository-wide `npm install`, existing test suite, and Vite production build cannot be rerun here;
- the new Compact contract cannot honestly be marked compiled;
- standalone Safe TypeScript can be typechecked and its protocol reference tests can be run locally.

These blocked checks must be performed before integrating Safe into the original Blackout application, claiming Compact/proof compatibility, or attempting deployment.
