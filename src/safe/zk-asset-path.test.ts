import { resolvePinnedAssetBaseUrl } from './midnight/security-hardening.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const origin = 'https://safe.example';

assert(
  resolvePinnedAssetBaseUrl('/zk-artifacts/blackout-safe', origin) ===
    'https://safe.example/zk-artifacts/blackout-safe',
  'Safe ZK path must remain allowed',
);

assert(
  resolvePinnedAssetBaseUrl('/zk-artifacts/blackout-test-asset', origin) ===
    'https://safe.example/zk-artifacts/blackout-test-asset',
  'Preview test-asset ZK path must be explicitly allowed',
);

for (const path of [
  '/zk-artifacts/other',
  'https://evil.example/zk-artifacts/blackout-test-asset',
  '/zk-artifacts/blackout-test-asset/../other',
]) {
  let rejected = false;
  try {
    resolvePinnedAssetBaseUrl(path, origin);
  } catch (error) {
    rejected = error instanceof Error && error.message === 'BLACKOUT_SAFE_ZK_ASSET_PATH_NOT_PINNED';
  }
  assert(rejected, `Unpinned ZK path must fail closed: ${path}`);
}

console.log('BLACKOUT SAFE ZK PATH TESTS: PASS');
