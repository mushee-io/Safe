# BLACKOUT SAFE — Privacy Model

## Privacy goals in Milestones 1–5
- Do not put a plaintext signer list in normal public state.
- Do not reveal which authorized member approved.
- Do not expose private proposal payload fields through public proposal state.
- Prevent duplicate approvals without using a persistent public signer ID.
- Bind authorization to the active membership and policy epochs.

## What is still observable
Privacy is not invisibility. Observers may learn that a Safe contract/state exists, that proposal commitments/nullifiers were posted, timing/order of transactions, aggregate approval counts in STANDARD mode, and any transaction-layer metadata that Midnight itself exposes.

## Merkle privacy boundary
Midnight Merkle ledger operations are selected because insertion hides the leaf through hashing and membership proofs can demonstrate inclusion without revealing which leaf is being proven. Normal Map/Set arguments are public, so they are not used as the member registry.

## Nullifier privacy boundary
Approval nullifiers are intentionally public. They must look like domain-separated hashes of private material and must not equal member commitments or wallet addresses.

## Proposal distribution
Midnight is not assumed to provide encrypted group messaging. Proposal ciphertext distribution will be an application-level authenticated encrypted channel/store. Clients must never trust decrypted payload bytes until recomputing and matching the on-chain proposal commitment.

## No overclaim
The local TypeScript reference model uses SHA-256 for deterministic invariant testing. Compact `persistentHash` has its own typed serialization. The reference hashes prove application invariants, not byte-for-byte Midnight proof compatibility.
