import { depositShielded, type PublicSafeRecord } from './runtime.ts';
import type { Hex32String } from '../safe/midnight/live-encoding.ts';

const SAFE_KEY = 'blackout-safe:public-safe:v1';
const ACTIVITY_KEY = 'blackout-safe:public-activity:v1';

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

function readDepositForm(): { color: Hex32String; value: bigint } {
  const colorInput = document.getElementById('deposit-color') as HTMLInputElement | null;
  const valueInput = document.getElementById('deposit-value') as HTMLInputElement | null;
  if (!colorInput || !valueInput) throw new Error('BLACKOUT_SAFE_DEPOSIT_FORM_MISSING');

  const color = colorInput.value.trim();
  const valueText = valueInput.value.trim();
  if (!/^(?:0x)?[0-9a-fA-F]{64}$/.test(color)) {
    throw new Error('BLACKOUT_SAFE_DEPOSIT_COLOR_MUST_BE_HEX32');
  }
  if (!/^\d+$/.test(valueText)) {
    throw new Error('BLACKOUT_SAFE_DEPOSIT_VALUE_MUST_BE_INTEGER');
  }
  const value = BigInt(valueText);
  if (value <= 0n) throw new Error('BLACKOUT_SAFE_DEPOSIT_VALUE_MUST_BE_POSITIVE');
  return { color: color as Hex32String, value };
}

async function submitDeposit(button: HTMLElement): Promise<void> {
  if (submitting) return;
  submitting = true;
  const originalText = button.textContent ?? 'Deposit';
  try {
    const { color, value } = readDepositForm();
    const safe = loadSafe();
    button.setAttribute('disabled', 'true');
    button.textContent = 'Submitting…';
    setStatus(button, `Submitting ${value.toString()} shielded base units to BLACKOUT SAFE…`);

    const result = await depositShielded(safe, color, value);
    recordActivity(result.txId, result.blockHeight);
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

// The product shell re-renders as soon as its generic busy-state helper starts.
// That used to erase the user/test-asset values before the deposit closure read
// them. Capture the click before the product-shell bubble listener so the exact
// form values are snapshotted and submitted without a render race.
document.addEventListener('click', (event) => {
  const target = (event.target as Element | null)?.closest<HTMLElement>('[data-action="deposit"]');
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void submitDeposit(target);
}, true);
