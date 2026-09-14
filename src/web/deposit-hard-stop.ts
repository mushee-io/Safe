export {};

const SAFE_KEY = 'blackout-safe:public-safe:v1';
const ACTIVITY_KEY = 'blackout-safe:public-activity:v1';
const TEST_ASSET_KEY = 'blackout-safe:test-asset-manifest:v1';
const PENDING_DEPOSIT_KEY = 'blackout-safe:pending-deposit:v1';
const ZERO32 = `0x${'0'.repeat(64)}`;
const DEFAULT_TEST_DEPOSIT = 100_000n;

interface SafeRecord {
  networkId: 'preview';
  contractAddress: string;
}

interface TestAssetManifest {
  version: 1;
  networkId: 'preview';
  color?: string;
}

function isHex32(value: string): boolean {
  return /^(?:0x)?[0-9a-fA-F]{64}$/.test(value);
}

function isRealColor(value: string): boolean {
  return isHex32(value) && value.toLowerCase() !== ZERO32.toLowerCase();
}

function positiveInteger(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : null;
}

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function resolveDeposit(): { color: string; value: bigint } {
  const colorInput = document.getElementById('deposit-color') as HTMLInputElement | null;
  const valueInput = document.getElementById('deposit-value') as HTMLInputElement | null;
  const visibleColor = colorInput?.value.trim() ?? '';
  const visibleValue = positiveInteger(valueInput?.value.trim() ?? '');

  if (isRealColor(visibleColor) && visibleValue) {
    return { color: visibleColor, value: visibleValue };
  }

  const manifest = loadJson<TestAssetManifest>(TEST_ASSET_KEY);
  if (!manifest || manifest.version !== 1 || manifest.networkId !== 'preview' || !manifest.color || !isRealColor(manifest.color)) {
    throw new Error('BLACKOUT_SAFE_REAL_TEST_ASSET_REQUIRED');
  }

  return { color: manifest.color, value: DEFAULT_TEST_DEPOSIT };
}

function loadSafe(): SafeRecord {
  const safe = loadJson<SafeRecord>(SAFE_KEY);
  if (!safe || safe.networkId !== 'preview' || !safe.contractAddress) {
    throw new Error('BLACKOUT_SAFE_ATTACH_OR_DEPLOY_SAFE_FIRST');
  }
  return safe;
}

function statusNode(button: HTMLElement): HTMLElement {
  const surface = button.closest<HTMLElement>('.surface');
  let node = surface?.querySelector<HTMLElement>('[data-deposit-hard-stop-status]') ?? null;
  if (!node) {
    node = document.createElement('div');
    node.dataset.depositHardStopStatus = 'true';
    node.className = 'notice';
    node.style.margin = '0 22px 18px';
    const footer = surface?.querySelector('.form-footer');
    if (footer?.parentElement) footer.parentElement.insertBefore(node, footer);
    else surface?.append(node);
  }
  return node;
}

function setStatus(button: HTMLElement, message: string, error = false): void {
  const node = statusNode(button);
  node.className = `notice${error ? ' danger' : ''}`;
  node.textContent = message;
}

function recordActivity(txId: string, blockHeight: number): void {
  let activity: Array<{ at: string; type: string; txId: string; detail: string }> = [];
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    if (raw) activity = JSON.parse(raw);
  } catch {
    activity = [];
  }
  activity.unshift({ at: new Date().toISOString(), type: 'DEPOSIT', txId, detail: `block ${blockHeight}` });
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity.slice(0, 100)));
}

let submitting = false;

document.addEventListener('click', (event) => {
  const button = (event.target as Element | null)?.closest<HTMLElement>('[data-action="deposit"]');
  if (!button) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  if (submitting) return;
  submitting = true;

  const originalText = button.textContent ?? 'Deposit';
  void (async () => {
    try {
      const { color, value } = resolveDeposit();
      const safe = loadSafe();

      button.setAttribute('disabled', 'true');
      button.textContent = 'Submitting…';
      setStatus(button, `Submitting ${value.toString()} shielded base units to BLACKOUT SAFE…`);

      const { depositShielded } = await import('./runtime.ts');
      const result = await depositShielded(safe as never, color as never, value);

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
  })();
}, true);
