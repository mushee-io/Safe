import { readFile } from 'node:fs/promises';

const contract = await readFile(new URL('../contract/blackout_test_asset.compact', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../src/safe/midnight/live-test-asset.ts', import.meta.url), 'utf8');
const compiled = await readFile(new URL('../src/safe/midnight/compiled-test-asset-contract.ts', import.meta.url), 'utf8');

const checks = [
  ['Preview test asset uses Compact language 0.23', /pragma language_version 0\.23;/.test(contract)],
  ['Mint uses shielded token primitive', /mintShieldedToken\(/.test(contract)],
  ['Mint routes to prover wallet public key', /ownPublicKey\(\)/.test(contract)],
  ['Mint requires positive amount', /BLACKOUT_TEST_ASSET_AMOUNT_MUST_BE_POSITIVE/.test(contract)],
  ['Mint has explicit Preview faucet cap', /BLACKOUT_TEST_ASSET_MINT_LIMIT/.test(contract)],
  ['Domain separation is BLACKOUT-specific', /blackout:safe:test-asset:v1/.test(contract)],
  ['Runtime uses dedicated ZK path', /BLACKOUT_TEST_ASSET_ZK_ASSET_PATH/.test(runtime)],
  ['Runtime uses canonical finalized transaction reference', /finalizedTransactionReference/.test(runtime)],
  ['Runtime rejects missing mint result', /BLACKOUT_TEST_ASSET_MINT_RESULT_MISSING/.test(runtime)],
  ['Runtime has no mainnet literal', !/mainnet/i.test(runtime)],
  ['Compiled asset path is same-origin relative', /\/zk-artifacts\/blackout-test-asset/.test(compiled)],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (ok) console.log(`PASS ${label}`);
  else { console.error(`FAIL ${label}`); failed += 1; }
}
if (failed) process.exit(1);
console.log(`BLACKOUT TEST ASSET: ${checks.length} security checks passed.`);
