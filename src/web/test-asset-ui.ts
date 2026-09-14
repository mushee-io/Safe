import {
  deployBlackoutTestAsset,
  mintBlackoutTestAsset,
  type BlackoutTestAssetDeployment,
} from '../safe/midnight/live-test-asset.ts';
import { getActiveSafeLaceSession } from '../safe/midnight/wallet-session.ts';

const STORAGE_KEY = 'blackout-safe:test-asset-manifest:v1';
const DEFAULT_MINT_AMOUNT = 1_000_000n;
const DEFAULT_DEPOSIT_AMOUNT = 100_000n;

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

let busy = false;
let message = '';
let messageType: 'success' | 'error' | 'info' = 'info';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function short(value?: string, left = 10, right = 8): string {
  if (!value) return '—';
  return value.length <= left + right + 3 ? value : `${value.slice(0, left)}…${value.slice(-right)}`;
}

function loadManifest(): TestAssetManifest | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TestAssetManifest;
    if (parsed?.version !== 1 || parsed.networkId !== 'preview' || !parsed.contractAddress) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveManifest(manifest: TestAssetManifest): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(manifest));
}

function publicDeployment(deployment: BlackoutTestAssetDeployment): TestAssetManifest {
  return {
    version: 1,
    networkId: 'preview',
    contractAddress: deployment.contractAddress,
    deploymentTxId: deployment.txId,
    deploymentBlockHeight: deployment.blockHeight,
  };
}

function downloadManifest(manifest: TestAssetManifest): void {
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'blackout-safe-preview-test-asset.json';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function renderPanel(): string {
  const manifest = loadManifest();
  const connected = Boolean(getActiveSafeLaceSession());
  const status = manifest?.color ? 'Shielded test asset minted' : manifest ? 'Test asset contract deployed' : 'Not deployed';
  const actionLabel = busy
    ? 'Working…'
    : manifest
      ? 'Mint 1,000,000 shielded units'
      : 'Deploy & mint test asset';

  return `
    <section class="surface" id="blackout-test-asset-panel">
      <div class="surface-head">
        <div><h2>Preview test asset</h2><span>Real shielded token for BLACKOUT SAFE end-to-end testing</span></div>
        <span class="live-pill">PREVIEW ONLY</span>
      </div>
      <div class="friendly-form two-col">
        <label><span>Status</span><input value="${escapeHtml(status)}" disabled></label>
        <label><span>Wallet session</span><input value="${connected ? 'Connected' : 'Connect Lace or 1AM first'}" disabled></label>
        <label><span>Token contract</span><input value="${escapeHtml(manifest ? short(manifest.contractAddress, 16, 12) : '—')}" disabled></label>
        <label><span>Token color</span><input value="${escapeHtml(manifest?.color ?? 'Mint once to discover')}" disabled></label>
      </div>
      ${manifest ? `<div class="advanced-grid" style="margin-top:16px">
        <div class="advanced-field"><span>Deployment tx</span><code>${escapeHtml(manifest.deploymentTxId)}</code></div>
        <div class="advanced-field"><span>Deployment block</span><code>${escapeHtml(manifest.deploymentBlockHeight)}</code></div>
        ${manifest.lastMintTxId ? `<div class="advanced-field"><span>Last mint tx</span><code>${escapeHtml(manifest.lastMintTxId)}</code></div>` : ''}
        ${manifest.lastMintBlockHeight !== undefined ? `<div class="advanced-field"><span>Last mint block</span><code>${escapeHtml(manifest.lastMintBlockHeight)}</code></div>` : ''}
      </div>` : ''}
      ${message ? `<div class="notice ${messageType === 'error' ? 'danger' : ''}" style="margin-top:16px"><strong>${messageType === 'error' ? 'Test asset error' : 'Test asset status'}</strong><span>${escapeHtml(message)}</span></div>` : ''}
      <div class="form-footer">
        <p>This faucet token has no value and is mintable only for Midnight Preview testing. It is not a production asset.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
          ${manifest?.color ? '<button class="secondary-button" data-test-asset-action="use-deposit">Use for deposit</button>' : ''}
          ${manifest ? '<button class="secondary-button" data-test-asset-action="download">Download manifest</button>' : ''}
          <button class="primary-button" data-test-asset-action="mint" ${busy || !connected ? 'disabled' : ''}>${escapeHtml(actionLabel)}</button>
        </div>
      </div>
    </section>
  `;
}

function mountPanel(): void {
  if (location.hash !== '#/assets') return;
  if (document.getElementById('blackout-test-asset-panel')) return;
  const content = document.getElementsByClassName('product-content').item(0) as HTMLElement | null;
  if (!content) return;
  const template = document.createElement('template');
  template.innerHTML = renderPanel().trim();
  const panel = template.content.firstElementChild;
  if (!panel) return;
  const surfaces = content.querySelectorAll('.surface');
  const depositSurface = surfaces[surfaces.length - 1];
  if (depositSurface?.parentElement === content) content.insertBefore(panel, depositSurface);
  else content.append(panel);
}

function rerenderPanel(): void {
  document.getElementById('blackout-test-asset-panel')?.remove();
  mountPanel();
}

async function deployAndMint(): Promise<void> {
  if (busy) return;
  const session = getActiveSafeLaceSession();
  if (!session) {
    message = 'Connect Lace or 1AM on Midnight Preview first.';
    messageType = 'error';
    rerenderPanel();
    return;
  }

  busy = true;
  message = '';
  rerenderPanel();
  try {
    let manifest = loadManifest();
    if (!manifest) {
      message = 'Deploying the Preview test-asset contract. Approve the wallet transaction.';
      messageType = 'info';
      rerenderPanel();
      const deployed = await deployBlackoutTestAsset(session);
      manifest = publicDeployment(deployed);
      saveManifest(manifest);
    }

    message = 'Minting 1,000,000 shielded test units to the connected wallet. Approve the wallet transaction.';
    messageType = 'info';
    rerenderPanel();
    const minted = await mintBlackoutTestAsset(manifest.contractAddress, DEFAULT_MINT_AMOUNT, session);
    manifest = {
      ...manifest,
      color: minted.coin.color,
      lastMintTxId: minted.txId,
      lastMintBlockHeight: minted.blockHeight,
      lastMintAmount: minted.coin.value,
      mintedAt: new Date().toISOString(),
    };
    saveManifest(manifest);
    downloadManifest(manifest);
    message = 'Mint confirmed. Open 1AM and wait for wallet sync; Shielded Holdings should become greater than 0. Then click “Use for deposit”.';
    messageType = 'success';
  } catch (error) {
    message = error instanceof Error ? error.message : 'BLACKOUT_TEST_ASSET_UNKNOWN_ERROR';
    messageType = 'error';
  } finally {
    busy = false;
    rerenderPanel();
  }
}

function fillDeposit(): void {
  const manifest = loadManifest();
  if (!manifest?.color) {
    message = 'Mint the test asset first so BLACKOUT SAFE knows the real token color.';
    messageType = 'error';
    rerenderPanel();
    return;
  }
  const color = document.getElementById('deposit-color') as HTMLInputElement | null;
  const value = document.getElementById('deposit-value') as HTMLInputElement | null;
  if (!color || !value) {
    message = 'Deposit form is not available on this screen.';
    messageType = 'error';
    rerenderPanel();
    return;
  }
  color.value = manifest.color;
  value.value = DEFAULT_DEPOSIT_AMOUNT.toString();
  message = `Deposit form filled with the real token color and ${DEFAULT_DEPOSIT_AMOUNT.toString()} base units.`;
  messageType = 'success';
  rerenderPanel();
}

document.addEventListener('click', (event) => {
  const target = (event.target as Element | null)?.closest<HTMLElement>('[data-test-asset-action]');
  const action = target?.dataset.testAssetAction;
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  if (action === 'mint') void deployAndMint();
  if (action === 'use-deposit') fillDeposit();
  if (action === 'download') {
    const manifest = loadManifest();
    if (manifest) downloadManifest(manifest);
  }
}, true);

window.addEventListener('hashchange', () => queueMicrotask(mountPanel));

const observer = new MutationObserver(() => mountPanel());
const app = document.getElementById('app');
if (app) observer.observe(app, { childList: true, subtree: true });
queueMicrotask(mountPanel);
