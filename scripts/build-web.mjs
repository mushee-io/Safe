import { access, chmod, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const TOOLCHAIN_COMMIT = '5cfbfd0929e7a7bd2674b21b7769b4a35106e25c';
const TOOLCHAIN_DIR = resolve('.blackout-toolchain');
const COMPACT = resolve('.blackout-toolchain/bin/compact');
const PREVIEW_CONTRACT = resolve('contract/blackout_safe.preview.compact');
const TEST_ASSET_CONTRACT = resolve('contract/blackout_test_asset.compact');
const PREPARE_ONLY = process.argv.includes('--prepare-only');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...options });
  if (result.status !== 0) throw new Error(`BLACKOUT_SAFE_BUILD_COMMAND_FAILED: ${command} ${args.join(' ')}`);
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function ensureToolchain() {
  if (!(await exists(resolve(TOOLCHAIN_DIR, '.git')))) {
    run('git', ['clone', '--quiet', 'https://github.com/mushee-io/Balckout-Pay.git', TOOLCHAIN_DIR]);
  }
  run('git', ['-C', TOOLCHAIN_DIR, 'fetch', '--quiet', 'origin', TOOLCHAIN_COMMIT]);
  run('git', ['-C', TOOLCHAIN_DIR, 'checkout', '--quiet', '--detach', TOOLCHAIN_COMMIT]);
  const head = spawnSync('git', ['-C', TOOLCHAIN_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (head.status !== 0 || head.stdout.trim() !== TOOLCHAIN_COMMIT) {
    throw new Error('BLACKOUT_SAFE_TOOLCHAIN_COMMIT_MISMATCH');
  }
  await chmod(COMPACT, 0o755);
  run(COMPACT, ['update', '0.31.1']);
  const version = spawnSync(COMPACT, ['compile', '--version'], { encoding: 'utf8' });
  if (version.status !== 0 || version.stdout.trim() !== '0.31.1') throw new Error('BLACKOUT_SAFE_COMPACT_VERSION_MISMATCH');
}

async function prepareArtifacts() {
  const safeBinding = resolve('contract/build-safe/contract/index.js');
  const safeStagedKey = resolve('public/zk-artifacts/blackout-safe/keys/propose_private.prover');
  const safeStagedReceipt = resolve('public/zk-artifacts/blackout-safe/keys/receipt_statement.prover');
  const testAssetBinding = resolve('contract/build-test-asset/contract/index.js');
  const testAssetStagedKey = resolve('public/zk-artifacts/blackout-test-asset/keys/mint_test_asset.prover');

  if (
    await exists(safeBinding) &&
    await exists(safeStagedKey) &&
    await exists(safeStagedReceipt) &&
    await exists(testAssetBinding) &&
    await exists(testAssetStagedKey)
  ) {
    console.log('BLACKOUT SAFE: using existing Safe + Preview test-asset artifacts.');
    return;
  }

  await ensureToolchain();
  await mkdir(resolve('contract'), { recursive: true });

  run(process.execPath, ['scripts/prepare-preview-contract.mjs']);
  run(process.execPath, ['scripts/publicize-receipt-mode.mjs']);
  run(process.execPath, ['scripts/add-stable-client-hash-helpers.mjs']);
  run(COMPACT, ['compile', PREVIEW_CONTRACT, 'contract/build-safe']);
  run(process.execPath, ['scripts/copy-safe-zk-artifacts.mjs']);
  run(process.execPath, ['scripts/check-deployment-footprint.mjs']);

  run(COMPACT, ['compile', TEST_ASSET_CONTRACT, 'contract/build-test-asset']);
  run(process.execPath, ['scripts/copy-test-asset-zk-artifacts.mjs']);
}

await prepareArtifacts();
if (!PREPARE_ONLY) {
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'build']);
}
