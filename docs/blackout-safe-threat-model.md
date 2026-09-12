# BLACKOUT SAFE — Threat Model (Milestones 1–5)

| Threat | Mitigation in current slice | Status |
|---|---|---|
| Outsider approves | Active Merkle membership proof required | Implemented in reference engine / designed in Compact |
| Same signer approves twice | Proposal-scoped public nullifier Set | Implemented |
| Signer tries another member commitment | Secret must open claimed member commitment | Implemented in reference engine; implicit in Compact derived leaf |
| Proposal recipient/amount substitution | Approval binds to full proposal commitment | Implemented |
| Replay approval across proposals | Proposal commitment included in nullifier | Implemented |
| Stale member after rotation | Membership version + current-root proof | Implemented in reference engine; rotation circuit later |
| Pending proposal survives unsafe membership change | Proposal stores membership version and approval rejects stale version | Implemented |
| Stale policy | Proposal stores policy version | Implemented model / contract check |
| Proposal data leak in public state | Public state stores commitment only | Implemented model |
| Historic-root authorization | Do not use HistoricMerkleTree for live authorization | Architectural mitigation |
| Frontend/log leakage | Privacy audit later; private payload types separated now | Partial |
| Proof server/indexer/wallet outage | LIVE integration must fail closed | Later integration milestone |
| Encrypted payload store substitution | Client commitment verification required | Designed; transport later |
| Governance takeover/recovery abuse | Threshold-governed rotation/pause, no master key | Later milestone |
