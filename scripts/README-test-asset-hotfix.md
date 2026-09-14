# Preview test-asset hotfix

This follow-up keeps the ZK asset loader fail-closed while explicitly permitting the two same-origin artifact roots used by BLACKOUT SAFE on Midnight Preview:

- `/zk-artifacts/blackout-safe`
- `/zk-artifacts/blackout-test-asset`

All other artifact paths remain rejected. Generic wallet/SDK `Request failed` wrappers also unwrap a nested cause when one exists so runtime failures remain diagnosable without leaking serialized private payloads.
