# BLACKOUT SAFE — Final Security Hardening

This pass hardens the completed M15–M20 implementation without expanding product scope.

## LIVE boundary

- Lace is selected by connector `name` / `rdns`; arbitrary injected Midnight-wallet fallback is forbidden.
- The connected wallet is revalidated before every provider build: Preview network, indexer endpoints, shielded keys/account identity and positive DUST must remain unchanged.
- HTTP/WSS endpoints must use secure transports except explicit localhost development.
- Safe private-state/signing-key providers are isolated by wallet session.
- ZK artifacts are pinned to the app's same-origin `/zk-artifacts/blackout-safe` path; callers cannot redirect LIVE proving to another host.
- LIVE circuit calls validate circuit IDs and exact argument counts before wallet access.
- returned deployment/call tx IDs and contract addresses are validated before they are surfaced as evidence.
- wallet/SDK error strings redact credential-bearing URLs and very large serialized hex payloads.

## Protocol

- Only canonical `TRANSFER` and `GOVERNANCE` action tags are accepted by the current Compact contract.
- unknown/non-canonical action tags fail closed instead of falling through to treasury execution.
- every proposal snapshots its original public policy commitment.
- historical quorum receipts open against that proposal policy snapshot, so later policy/membership changes do not silently destroy auditability.
- the snapshot adds no private rule, threshold, recipient, amount, signer or proposal-category disclosure.

## Release gate

A 64-hex transaction ID and contract address are not sufficient deployment evidence. `PREVIEW_DEPLOYED` additionally requires:

- network ID = `preview`
- finalized deployment state
- an explicit on-chain/indexer verification result

Production remains impossible to auto-approve and still requires deliberate manual security/privacy review.
