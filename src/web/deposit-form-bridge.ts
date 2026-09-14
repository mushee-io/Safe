import { depositShielded, type PublicSafeRecord } from './runtime.ts';
import type { Hex32String } from '../safe/midnight/live-encoding.ts';

const SAFE_KEY = 'blackout-safe:public-safe:v1';
const ACTIVITY_KEY = 'blackout-safe:public-activity:v1';
const PENDING_DEPOSIT_KEY = 'blackout-safe:pending-deposit:v1';
const TEST_ASSET_STORAGE_KEY = 'blackout-safe:test-asset-manifest:v1';
const ZERO32 = `0x${'0'.repeat(64)}`;
const DEFAULT_TEST_ASSET_DEPOSIT_AMOUNT = 100_000n;

interface PendingDeposit {
  version: 1;
  networkId: 'preview';
  contractAddress: string;
  color: string;
  value: string;
  preparedAt: string;
}

interface TestAssetManifest {
  version: 1;
  networkId: 'preview';
  contractAddress: string;
  deploymentTxId: string;
  deploymentBlockHeight: number;
  color?: string;
  lastMintTxId?: string;
  lastMintBlockHeight?: number;
  lastMintAmount?: string;
  mintedAt?: string;
}

let submitting = false;

function loadSafe(): PublicSafeRecord {
  const raw = localStorage.getItem(SAFE_KEY);
  if (!raw) throw new Error('BLACKOUT_SAFE_ATTACH_OR_DEPLOY_SAFE_FIRST');
  const safe = JSON.parse(raw) as PublicSafeRecord;
  if (!safe?.contractAddress || safe.networkId !== 'preview') {
    throw new Error('BLACKOUT_SAFE_INVALID_LOCAL_SAFE');
  }
  return safe;
}

function isValidColor(value: string): boolean {
  return /^(?:0x)?[0-9a-fA-F]{64}$/.test(value) && value.toLowerCase() !== ZERO32.toLowerCase();
}

function isValidPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value) && BigInt(value) > 0n;
}

function loadPendingDeposit(): PendingDeposit | null {
  try {
    const raw = localStorage.getItem(PENDING_DEPOSIT_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as PendingDeposit;
    if (pending?.version !== 1 || pending.networkId !== 'preview') return null;
    if (!isValidColor(pending.color)) return null;
    if (!isValidPositiveInteger(pending.value)) return null;
    return pending;
  } catch {
    return null;
  }
}

function loadRealMintedTestAsset(): TestAssetManifest | null {
  try {
    const raw = localStorage.getItem(TEST_ASSET_STORAGE_KEY);
    if (!raw) return null;
    const manifest = JSON.parse(raw) as TestAssetManifest;
    if (manifest?.version !== 1 || manifest.networkId !== 'preview') return null;
    if (!manifest.contractAddress || !manifest.deploymentTxId) return null;
    if (!manifest.lastMintTxId || manifest.lastMintBlockHeight === undefined) return null;
    if (!manifest.color || !isValidColor(manifest.color)) return null;
    return manifest;
  } catch {
    return null;
  }
}

function persistManifestDeposit(manifest: TestAssetManifest): PendingDeposit {
  if (!manifest.color || !isValidColor(manifest.color)) {
    throw new Error('BLACKOUT_SAFE_DEPOSIT_REAL_TEST_ASSET_COLOR_REQUIRED');
  }
  const pending: PendingDeposit = {
    version: 1,
    networkId: 'preview',
    contractAddress: manifest.contractAddress,
    color: manifest.color,
    value: DEFAULT_TEST_ASSET_DEPOSIT_AMOUNT.toString(),
    preparedAt: new Date().toISOString(),
  };
  localStorage.setItem(PENDING_DEPOSIT_KEY, JSON.stringify(pending));
  return pending;
}

function recordActivity(txId: string, blockHeight: number): void {
  let activity: Array<{ at: string; type: string; txId: string; detail: string }> = [];
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    if (raw) activity = JSON.parse(raw);
  } catch {
    activity = [];
  }
  activity.unshift({
    at: new Date().toISOString(),
    type: 'DEPOSIT',
    txId,
    detail: `block ${blockHeight}`,
  });
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity.slice(0, 100)));
}

function statusNode(button: HTMLElement): HTMLElement {
  const surface = button.closest<HTMLElement>('.surface');
  let node = surface?.querySelector<HTMLElement>('[data-deposit-bridge-status]') ?? null;
  if (!node) {
    node = document.createElement('div');
    node.dataset.depositBridgeStatus = 'true';
    node.className = 'notice';
    node.style.margin = '0 22px 18px';
    const footer = surface?.querySelector('.form-footer');
    if (footer && footer.parentElement) footer.parentElement.insertBefore(node, footer);
    else surface?.append(node);
  }
  return node;
}

function setStatus(button: HTMLElement, message: string, error = false): void {
  const node = statusNode(button);
  node.className = `notice${error ? ' danger' : ''}`;
  node.textContent = message;
}

function hydratePendingDeposit(): void {
  if (location.hash !== '#/assets') return;
  let pending = loadPendingDeposit();
  if (!pending) {
    const manifest = loadRealMintedTestAsset();
    if (manifest) pending = persistManifestDeposit(manifest);
  }
  if (!pending) return;

  const colorInput = document.getElementById('deposit-color') as HTMLInputElement | null;
  const valueInput = document.getElementById('deposit-value') as HTMLInputElement | null;
  if (!colorInput || !valueInput) return;

  const currentColor = colorInput.value.trim();
  const currentValue = valueInput.value.trim();
  if (!isValidColor(currentColor)) colorInput.value = pending.color;
  if (!isValidPositiveInteger(currentValue)) valueInput.value = pending.value;
}

function readDepositForm(): { color: Hex32String; value: bigint; source: 'form' | 'pending' | 'manifest' } {
  const colorInput = document.getElementById('deposit-color') as HTMLInputElement | null;
  const valueInput = document.getElementById('deposit-value') as HTMLInputElement | null;
  if (!colorInput || !valueInput) throw new Error('BLACKOUT_SAFE_DEPOSIT_FORM_MISSING');

  const color = colorInput.value.trim();
  const valueText = valueInput.value.trim();
  if (isValidColor(color) && isValidPositiveInteger(valueText)) {
    return { color: color as Hex32String, value: BigInt(valueText), source: 'form' };
  }

  const pending = loadPendingDeposit();
  if (pending) {
    colorInput.value = pending.color;
    valueInput.value = pending.value;
    return { color: pending.color as Hex32String, value: BigInt(pending.value), source: 'pending' };
  }

  // Final Preview-test fallback: derive only from the real, successfully minted
  // test-asset manifest. This avoids depending on transient DOM state while still
  // refusing to invent a color or submit a simulated transaction.
  const manifest = loadRealMintedTestAsset();
  if (manifest) {
    const recovered = persistManifestDeposit(manifest);
    colorInput.value = recovered.color;
    valueInput.value = recovered.value;
    return {
      color: recovered.color as Hex32String,
      value: BigInt(recovered.value),
      source: 'manifest',
    };
  }

  if (!/^(?:0x)?[0-9a-fA-F]{64}$/.test(color)) {
    throw new Error('BLACKOUT_SAFE_DEPOSIT_COLOR_MUST_BE_HEX32');
  }
  if (color.toLowerCase() === ZERO32.toLowerCase()) {
    throw new Error('BLACKOUT_SAFE_DEPOSIT_COLOR_NOT_SELECTED');
  }
  if (!/^\d+$/.test(valueText)) {
    throw new Error('BLACKOUT_SAFE_DEPOSIT_VALUE_MUST_BE_INTEGER');
  }
  const value = BigInt(valueText);
  if (value <= 0n) throw new Error('BLACKOUT_SAFE_DEPOSIT_VALUE_MUST_BE_POSITIVE');
  return { color: color as Hex32String, value, source: 'form' };
}

async function submitDeposit(button: HTMLElement): Promise<void> {
  if (submitting) return;
  submitting = true;
  const originalText = button.textContent ?? 'Deposit';
  try {
    const { color, value, source } = readDepositForm();
    const safe = loadSafe();
    button.setAttribute('disabled', 'true');
    button.textContent = 'Submitting…';
    setStatus(
      button,
      `Submitting ${value.toString()} shielded base units to BLACKOUT SAFE${source === 'manifest' ? ' using the real minted test-asset manifest' : ''}…`,
    );

    const result = await depositShielded(safe, color, value);
    recordActivity(result.txId, result.blockHeight);
    localStorage.removeItem(PENDING_DEPOSIT_KEY);
    setStatus(button, `Deposit submitted. Tx ${result.txId} · block ${result.blockHeight}`);
    button.textContent = 'Deposited';
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'BLACKOUT_SAFE_DEPOSIT_FAILED';
    setStatus(button, message, true);
    button.removeAttribute('disabled');
    button.textContent = originalText;
  } finally {
    submitting = false;
  }
}

// Capture deposit before the product shell can enter a busy-state render. If the
// form was reset, recover from the persisted selection or, as a final Preview
// test path, from the real successfully minted test-asset manifest.
document.addEventListener('click', (event) => {
  const target = (event.target as Element | null)?.closest<HTMLElement>('[data-action="deposit"]');
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void submitDeposit(target);
}, true);

window.addEventListener('hashchange', () => queueMicrotask(hydratePendingDeposit));

const app = document.getElementById('app');
if (app) {
  const observer = new MutationObserver(() => queueMicrotask(hydratePendingDeposit));
  observer.observe(app, { childList: true, subtree: true });
}
queueMicrotask(hydratePendingDeposit);
