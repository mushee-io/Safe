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

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function resolveDirectTestDeposit(): { color: string; value: bigint } {
  const manifest = loadJson<TestAssetManifest>(TEST_ASSET_KEY);
  if (!manifest || manifest.version !== 1 || manifest.networkId !== 'preview' || !manifest.color || !isRealColor(manifest.color)) {
    throw new Error('BLACKOUT_SAFE_REAL_TEST_ASSET_REQUIRED');
  }

  // This Preview test path is intentionally deterministic. Do not read or parse
  // the transient DOM amount field: app-v2 re-renders that field during actions.
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
  let node = surface?.querySelector<HTMLElement>('[data-deposit-direct-status]') ?? null;
  if (!node) {
    node = document.createElement('div');
    node.dataset.depositDirectStatus = 'true';
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

async function submitDirectDeposit(button: HTMLElement): Promise<void> {
  if (submitting) return;
  submitting = true;

  const originalText = button.textContent ?? 'Deposit';
  try {
    const { color, value } = resolveDirectTestDeposit();
    const safe = loadSafe();

    button.setAttribute('disabled', 'true');
    button.textContent = 'Submitting…';
    setStatus(button, `Direct shielded engine · submitting ${value.toString()} base units…`);

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
}

function wireDepositButton(): void {
  const legacyButtons = document.querySelectorAll<HTMLElement>('[data-action="deposit"]');
  for (const button of legacyButtons) {
    // Remove app-v2's action marker entirely so its legacy parser can never see
    // this click. This avoids BLACKOUT_SAFE_DEPOSIT_VALUE_MUST_BE_INTEGER at source.
    button.removeAttribute('data-action');
    button.dataset.depositDirect = 'true';
    button.setAttribute('type', 'button');
    button.setAttribute('aria-label', 'Deposit 100000 shielded test-asset base units');
    button.textContent = 'Deposit';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      void submitDirectDeposit(button);
    });
    setStatus(button, 'Direct shielded engine ready · 100000 base units');
  }
}

// Backup capture guard for the tiny window between an app re-render and the
// MutationObserver rewiring the newly-created button.
document.addEventListener('click', (event) => {
  const button = (event.target as Element | null)?.closest<HTMLElement>('[data-action="deposit"]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  button.removeAttribute('data-action');
  button.dataset.depositDirect = 'true';
  void submitDirectDeposit(button);
}, true);

const observer = new MutationObserver(() => wireDepositButton());
observer.observe(document.documentElement, { childList: true, subtree: true });

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireDepositButton, { once: true });
} else {
  wireDepositButton();
}
