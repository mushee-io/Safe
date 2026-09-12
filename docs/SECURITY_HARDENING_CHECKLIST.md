# BLACKOUT SAFE — Security Hardening Verification Checklist

A hardening change is not eligible for `main` unless all items below are green.

- [ ] all protocol, privacy, witness and hardening tests pass
- [ ] strict TypeScript passes against compiler-generated Safe bindings
- [ ] Compact 0.31.1 / language 0.23.0 / ledger 8.0.2 / runtime 0.16.0 remain pinned
- [ ] all 15 exported circuits remain present
- [ ] full ZKIR + prover + verifier generation passes
- [ ] all browser proving artifacts are staged
- [ ] no arbitrary external ZK artifact host is accepted by LIVE code
- [ ] non-Lace injected-wallet fallback is rejected
- [ ] Preview session is revalidated before transaction construction
- [ ] wallet account/network/config changes invalidate the LIVE session
- [ ] private-state/signing-key providers are wallet-session isolated
- [ ] unsupported proposal action tags fail closed
- [ ] historical quorum receipt binds to the proposal's original policy commitment
- [ ] Preview deployment promotion requires finalized on-chain verification
- [ ] production remains manually gated
