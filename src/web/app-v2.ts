import './product.css';
import {
  approveProposal,
  attachExistingSafe,
  bootstrapSafe,
  connectWallet,
  createGovernanceProposal,
  createTransferProposal,
  deployBootstrap,
  depositShielded,
  disconnectWallet,
  executeGovernance,
  executeTransfer,
  proveQuorum,
  refreshWallet,
  runReceiptCircuit,
  type BootstrapResult,
  type GovernanceAction,
  type PublicSafeRecord,
  type TxResultView,
  type WalletView,
} from './runtime.ts';
import {
  bytesToHex32,
  type Hex32String,
  type SerializedPolicyOpening,
  type SerializedProposalBundle,
  type SerializedSafeSignerKit,
} from '../safe/midnight/live-encoding.ts';

const SAFE_KEY = 'blackout-safe:public-safe:v1';
const ACTIVITY_KEY = 'blackout-safe:public-activity:v1';
const ZERO32 = `0x${'0'.repeat(64)}`;

type View = 'dashboard' | 'assets' | 'transactions' | 'members' | 'policies' | 'activity' | 'security' | 'settings';
type Modal = 'wallet' | 'bootstrap' | 'attach' | 'new-transaction' | 'receive' | 'approve' | 'quorum' | 'execute' | 'governance' | null;

type ToastType = 'success' | 'error' | 'info';

interface ActivityItem {
  at: string;
  type: string;
  txId: string;
  detail: string;
}

interface AppState {
  view: View;
  modal: Modal;
  wallet: WalletView | null;
  safe: PublicSafeRecord | null;
  bootstrap: BootstrapResult | null;
  activity: ActivityItem[];
  busy: string | null;
  toasts: Array<{ id: number; type: ToastType; message: string }>;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('BLACKOUT_SAFE_APP_ROOT_MISSING');

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

const initialHash = location.hash.replace('#/', '') as View;
const validViews: View[] = ['dashboard', 'assets', 'transactions', 'members', 'policies', 'activity', 'security', 'settings'];

const state: AppState = {
  view: validViews.includes(initialHash) ? initialHash : 'dashboard',
  modal: null,
  wallet: null,
  safe: loadJson<PublicSafeRecord>(SAFE_KEY),
  bootstrap: null,
  activity: loadJson<ActivityItem[]>(ACTIVITY_KEY) ?? [],
  busy: null,
  toasts: [],
};

function h(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function short(value?: string | null, left = 8, right = 6): string {
  if (!value) return '—';
  return value.length <= left + right + 3 ? value : `${value.slice(0, left)}…${value.slice(-right)}`;
}

function savePublicState(): void {
  if (state.safe) localStorage.setItem(SAFE_KEY, JSON.stringify(state.safe));
  else localStorage.removeItem(SAFE_KEY);
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(state.activity.slice(0, 100)));
}

function inputValue(id: string): string {
  const element = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (!element) throw new Error(`BLACKOUT_SAFE_INPUT_MISSING_${id}`);
  return element.value.trim();
}

function parseJsonInput<T>(id: string, label: string): T {
  const value = inputValue(id);
  if (!value) throw new Error(`${label}_REQUIRED`);
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label}_INVALID_JSON`);
  }
}

function asBigInt(value: string, label: string, allowZero = true): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${label}_MUST_BE_INTEGER`);
  const parsed = BigInt(value);
  if ((!allowZero && parsed <= 0n) || (allowZero && parsed < 0n)) throw new Error(`${label}_OUT_OF_RANGE`);
  return parsed;
}

function toast(message: string, type: ToastType = 'info'): void {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  state.toasts.push({ id, type, message });
  render();
  window.setTimeout(() => {
    state.toasts = state.toasts.filter((item) => item.id !== id);
    render();
  }, 5000);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'BLACKOUT_SAFE_UNKNOWN_ERROR';
}

async function runBusy<T>(name: string, operation: () => Promise<T>): Promise<T | null> {
  if (state.busy) return null;
  state.busy = name;
  render();
  try {
    return await operation();
  } catch (error) {
    toast(errorMessage(error), 'error');
    return null;
  } finally {
    state.busy = null;
    render();
  }
}

function addActivity(type: string, tx: TxResultView | { txId: string }, detail: string): void {
  state.activity.unshift({ at: new Date().toISOString(), type, txId: tx.txId, detail });
  state.activity = state.activity.slice(0, 100);
  savePublicState();
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function requireSafe(): PublicSafeRecord {
  if (!state.safe) throw new Error('BLACKOUT_SAFE_ATTACH_OR_DEPLOY_SAFE_FIRST');
  return state.safe;
}

function icon(name: string): string {
  const paths: Record<string, string> = {
    dashboard: '<path d="M4 4h6v6H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 14h6v6H4z"/>',
    assets: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/>',
    transactions: '<path d="M5 7h12M13 3l4 4-4 4M19 17H7M11 13l-4 4 4 4"/>',
    members: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20c0-4 2.5-7 6-7s6 3 6 7M15 14c3 0 5 2 5 5"/>',
    policies: '<path d="M12 3l7 3v5c0 4.5-2.8 8-7 10-4.2-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-5"/>',
    activity: '<path d="M4 12h3l2-5 4 10 2-5h5"/>',
    security: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7a6 6 0 00-.6-1.4l.9-1.9-2.1-2.1-1.9.9A6 6 0 0012 4.7L11.3 3h-3l-.7 1.7a6 6 0 00-1.4.6l-1.9-.9-2.1 2.1.9 1.9a6 6 0 00-.6 1.4L1 10.5v3l1.7.7c.1.5.3 1 .6 1.4l-.9 1.9 2.1 2.1 1.9-.9c.4.3.9.5 1.4.6l.7 1.7h3l.7-1.7c.5-.1 1-.3 1.4-.6l1.9.9 2.1-2.1-.9-1.9c.3-.4.5-.9.6-1.4z" transform="translate(1 0) scale(.9)"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? ''}</svg>`;
}

function navButton(view: View, label: string): string {
  return `<button class="nav-item ${state.view === view ? 'active' : ''}" data-view="${view}">${icon(view)}<span>${h(label)}</span></button>`;
}

function renderShell(): string {
  const walletLabel = state.wallet ? state.wallet.walletName : 'Connect wallet';
  return `
    <div class="product-shell">
      <aside class="product-sidebar">
        <div class="logo-row"><div class="logo-mark"><span></span></div><div><strong>BLACKOUT</strong><small>SAFE</small></div></div>
        <div class="safe-switcher">
          <div class="safe-avatar">B</div>
          <div class="safe-switcher-copy"><strong>Private Treasury</strong><span>${state.safe ? short(state.safe.contractAddress) : 'No Safe attached'}</span></div>
          <span class="chevron">⌄</span>
        </div>
        <nav class="product-nav">
          ${navButton('dashboard', 'Dashboard')}
          ${navButton('assets', 'Assets')}
          ${navButton('transactions', 'Transactions')}
          ${navButton('members', 'Members')}
          ${navButton('policies', 'Policies')}
          ${navButton('activity', 'Activity')}
          <div class="nav-divider"></div>
          <button class="nav-item disabled" disabled>${icon('assets')}<span>Apps</span><span class="soon">Soon</span></button>
          ${navButton('security', 'Security')}
          ${navButton('settings', 'Settings')}
        </nav>
        <div class="sidebar-bottom">
          <div class="network-pill"><span class="network-dot"></span>Midnight Preview</div>
          <div class="privacy-note">Private by default. Authorization is proved without publishing treasury intelligence.</div>
        </div>
      </aside>

      <main class="product-main">
        <header class="product-header">
          <div class="mobile-brand"><div class="logo-mark small"><span></span></div><strong>BLACKOUT SAFE</strong></div>
          <div></div>
          <div class="header-actions">
            ${state.safe ? `<span class="status-chip ${state.safe.deploymentVerifiedOnChain ? 'verified' : ''}">${state.safe.deploymentVerifiedOnChain ? 'Verified' : 'Preview Safe'}</span>` : ''}
            <button class="wallet-button ${state.wallet ? 'connected' : ''}" data-action="${state.wallet ? 'disconnect-wallet' : 'open-wallet'}">
              <span class="wallet-status"></span>${h(walletLabel)}
            </button>
          </div>
        </header>
        <section class="product-content">${renderView()}</section>
      </main>
    </div>
    ${renderModal()}
    ${renderToasts()}
  `;
}

function renderView(): string {
  switch (state.view) {
    case 'assets': return renderAssets();
    case 'transactions': return renderTransactions();
    case 'members': return renderMembers();
    case 'policies': return renderPolicies();
    case 'activity': return renderActivity();
    case 'security': return renderSecurity();
    case 'settings': return renderSettings();
    default: return renderDashboard();
  }
}

function pageHeader(title: string, subtitle: string, action = ''): string {
  return `<div class="page-header"><div><h1>${h(title)}</h1><p>${h(subtitle)}</p></div>${action}</div>`;
}

function quickAction(action: string, label: string, symbol: string, disabled = false): string {
  return `<button class="quick-action" data-action="${action}" ${disabled ? 'disabled' : ''}><span class="quick-icon">${symbol}</span><span>${h(label)}</span></button>`;
}

function renderDashboard(): string {
  const safe = state.safe;
  const memberCount = state.bootstrap?.membership.kits.length;
  const threshold = state.bootstrap?.policy.threshold?.toString() ?? safe?.publicQuorum ?? null;
  const pending = state.activity.filter((item) => ['PROPOSE', 'APPROVE', 'QUORUM', 'GOV_PROPOSE'].includes(item.type)).slice(0, 4);
  const recent = state.activity.slice(0, 5);

  return `
    ${pageHeader('Private Treasury', 'A human treasury interface over BLACKOUT SAFE zero-knowledge controls.')}
    <section class="balance-card">
      <div class="balance-top"><span>Total treasury</span><span class="privacy-badge">Shielded</span></div>
      <div class="balance-value">Private</div>
      <div class="balance-sub">BLACKOUT SAFE does not fabricate a portfolio value before real asset discovery is available.</div>
      <div class="quick-actions">
        ${quickAction('open-new-transaction', 'Send', '↗', !safe)}
        ${quickAction('open-receive', 'Receive', '↙', !safe)}
        ${quickAction('open-new-transaction', 'New transaction', '+', !safe)}
      </div>
    </section>

    <div class="dashboard-grid">
      <section class="surface span-2">
        <div class="surface-head"><div><h2>Assets</h2><span>Shielded treasury positions</span></div><button class="text-button" data-view="assets">View assets</button></div>
        ${safe ? `
          <div class="asset-row">
            <div class="token-icon blackout-token">B</div>
            <div class="row-primary"><strong>Shielded treasury</strong><span>Midnight Preview</span></div>
            <div class="row-value"><strong>Private</strong><span>Not publicly indexed</span></div>
          </div>
          <div class="asset-row">
            <div class="token-icon dust-token">D</div>
            <div class="row-primary"><strong>DUST</strong><span>Wallet execution balance</span></div>
            <div class="row-value"><strong>${state.wallet ? h(state.wallet.dust) : '—'}</strong><span>${state.wallet ? h(state.wallet.walletName) : 'Connect wallet'}</span></div>
          </div>` : renderEmpty('Create or attach a Safe', 'Assets appear here only from real wallet / Preview state.', 'open-bootstrap', 'Create Safe')}
      </section>

      <section class="surface">
        <div class="surface-head"><div><h2>Members</h2><span>Private authorization set</span></div><button class="text-button" data-view="members">Manage</button></div>
        <div class="member-summary"><div class="member-orbit"><span></span><span></span><span></span></div><div><strong>${memberCount ?? 'Private'}</strong><span>${memberCount ? 'members in current bootstrap' : 'member count not exposed'}</span></div></div>
        <div class="summary-line"><span>Approval threshold</span><strong>${threshold ? `${h(threshold)} ${memberCount ? `of ${memberCount}` : ''}` : 'Private'}</strong></div>
        <div class="summary-line"><span>Policy</span><strong>${safe ? h(safe.policyMode === 'PRIVATE_POLICY' ? 'Private policy' : 'Standard') : 'Not configured'}</strong></div>
      </section>

      <section class="surface span-2">
        <div class="surface-head"><div><h2>Pending transactions</h2><span>Proposals and approvals created in this browser</span></div><button class="text-button" data-view="transactions">View all</button></div>
        ${pending.length ? `<div class="transaction-list">${pending.map(renderActivityRow).join('')}</div>` : renderEmpty('Nothing waiting', 'New private proposals and approvals will appear here.', 'open-new-transaction', 'New transaction', !safe)}
      </section>

      <section class="surface">
        <div class="surface-head"><div><h2>Safe status</h2><span>Preview readiness</span></div></div>
        <div class="health-list">
          ${healthRow('Network', 'Midnight Preview', true)}
          ${healthRow('Wallet', state.wallet ? state.wallet.walletName : 'Disconnected', Boolean(state.wallet))}
          ${healthRow('Contract', safe ? 'Attached' : 'Not attached', Boolean(safe))}
          ${healthRow('Verification', safe?.deploymentVerifiedOnChain ? 'On-chain verified' : 'Pending', Boolean(safe?.deploymentVerifiedOnChain))}
        </div>
      </section>
    </div>

    <section class="surface recent-surface">
      <div class="surface-head"><div><h2>Recent activity</h2><span>Public transaction metadata only</span></div><button class="text-button" data-view="activity">Open activity</button></div>
      ${recent.length ? `<div class="transaction-list">${recent.map(renderActivityRow).join('')}</div>` : renderEmpty('No activity yet', 'BLACKOUT SAFE stores only public transaction metadata in this browser.')}
    </section>
  `;
}

function renderAssets(): string {
  return `
    ${pageHeader('Assets', 'Treasury assets stay private. Deposits are real Preview transactions; portfolio values are never invented.', `<button class="primary-button" data-action="open-receive">Receive assets</button>`)}
    <div class="asset-overview">
      <section class="balance-mini"><span>Total balance</span><strong>Private</strong><small>Shielded by design</small></section>
      <section class="balance-mini"><span>Network</span><strong>Preview</strong><small>Midnight test network</small></section>
      <section class="balance-mini"><span>Execution balance</span><strong>${state.wallet ? h(state.wallet.dust) : '—'}</strong><small>DUST · ${state.wallet ? h(state.wallet.walletName) : 'wallet disconnected'}</small></section>
    </div>

    <section class="surface">
      <div class="surface-head"><div><h2>Asset positions</h2><span>No synthetic balances</span></div></div>
      ${state.safe ? `
        <div class="asset-row asset-row-large"><div class="token-icon blackout-token">B</div><div class="row-primary"><strong>BLACKOUT shielded assets</strong><span>Contract ${h(short(state.safe.contractAddress, 10, 8))}</span></div><div class="row-value"><strong>Private</strong><span>Asset discovery pending</span></div></div>
        ${state.wallet ? `<div class="asset-row asset-row-large"><div class="token-icon dust-token">D</div><div class="row-primary"><strong>DUST</strong><span>Wallet gas / execution</span></div><div class="row-value"><strong>${h(state.wallet.dust)}</strong><span>${h(state.wallet.walletName)}</span></div></div>` : ''}
      ` : renderEmpty('No Safe attached', 'Create or attach a Preview Safe before funding it.', 'open-bootstrap', 'Create Safe')}
    </section>

    <section class="surface">
      <div class="surface-head"><div><h2>Deposit</h2><span>Real shielded deposit</span></div><span class="live-pill">Live call</span></div>
      <div class="friendly-form two-col">
        <label><span>Asset color / token type</span><input id="deposit-color" value="${ZERO32}" autocomplete="off" spellcheck="false"></label>
        <label><span>Amount · base units</span><input id="deposit-value" placeholder="1000000" inputmode="numeric" autocomplete="off"></label>
      </div>
      <div class="form-footer"><p>The wallet balances and submits the actual <code>deposit_shielded</code> Preview transaction.</p><button class="primary-button" data-action="deposit" ${state.safe && state.wallet ? '' : 'disabled'}>${state.busy === 'deposit' ? 'Submitting…' : 'Deposit'}</button></div>
    </section>
  `;
}

function renderTransactions(): string {
  const transactionActivity = state.activity.filter((item) => ['PROPOSE', 'APPROVE', 'QUORUM', 'EXECUTE_TRANSFER'].includes(item.type));
  return `
    ${pageHeader('Transactions', 'Create, approve and execute private treasury transactions without exposing the internal decision graph.', `<button class="primary-button" data-action="open-new-transaction" ${state.safe ? '' : 'disabled'}>New transaction</button>`)}
    <div class="tabs"><button class="tab active">Queue</button><button class="tab">Awaiting approvals</button><button class="tab">Ready to execute</button><button class="tab">Completed</button></div>
    <section class="surface transaction-surface">
      ${transactionActivity.length ? `<div class="transaction-list">${transactionActivity.map(renderActivityRow).join('')}</div>` : renderEmpty('No treasury transactions', 'Create a private transaction. Sensitive proposal content stays outside public state.', 'open-new-transaction', 'New transaction', !state.safe)}
    </section>
    <div class="transaction-actions-grid">
      <section class="action-card"><div class="action-card-icon">✓</div><h3>Approve a transaction</h3><p>Use an authorized private signer kit. Duplicate approvals do not count twice.</p><button class="secondary-button" data-action="open-approve" ${state.safe ? '' : 'disabled'}>Approve</button></section>
      <section class="action-card"><div class="action-card-icon">3/5</div><h3>Prove quorum</h3><p>Prove that the policy threshold was satisfied without publishing signer identities.</p><button class="secondary-button" data-action="open-quorum" ${state.safe ? '' : 'disabled'}>Prove quorum</button></section>
      <section class="action-card"><div class="action-card-icon">↗</div><h3>Execute transfer</h3><p>Execute an approved shielded transfer using the real held-coin opening.</p><button class="secondary-button" data-action="open-execute" ${state.safe ? '' : 'disabled'}>Execute</button></section>
    </div>
  `;
}

function renderMembers(): string {
  const count = state.bootstrap?.membership.kits.length;
  const threshold = state.bootstrap?.policy.threshold?.toString() ?? state.safe?.publicQuorum;
  return `
    ${pageHeader('Members', 'Private signer membership and approval threshold.', `<button class="primary-button" data-action="open-bootstrap">${state.safe ? 'Create another Safe' : 'Create Safe'}</button>`)}
    <div class="member-stat-grid">
      <section class="member-stat"><span>Members</span><strong>${count ?? 'Private'}</strong><small>${count ? 'Generated in this browser session' : 'Not exposed by the public manifest'}</small></section>
      <section class="member-stat"><span>Threshold</span><strong>${threshold ?? 'Private'}</strong><small>${state.safe?.policyMode === 'PRIVATE_POLICY' ? 'Hidden by private policy' : 'Required approvals'}</small></section>
      <section class="member-stat"><span>Membership version</span><strong>${state.safe?.membershipVersion ?? '—'}</strong><small>Rotations advance this version</small></section>
    </div>
    <section class="surface">
      <div class="surface-head"><div><h2>Authorization set</h2><span>Signer identities are intentionally not a public address book</span></div></div>
      ${state.bootstrap ? `<div class="private-members">${state.bootstrap.membership.kits.map((kit, i) => `<div class="private-member"><div class="member-avatar">${i + 1}</div><div><strong>Private signer ${i + 1}</strong><span>${h(short(kit.memberCommitment, 14, 10))}</span></div><button class="secondary-button compact" data-action="download-signer" data-index="${i}">Export kit</button></div>`).join('')}</div>` : renderEmpty('Member identities stay private', 'Generate a new Safe in this session to export signer kits. Existing Safe member identities are not reconstructed from public state.')}
    </section>
    <section class="surface warning-surface"><div><strong>Membership changes require governance.</strong><p>Rotating members is a quorum-gated action, not a hidden admin override.</p></div><button class="secondary-button" data-action="open-governance" ${state.safe ? '' : 'disabled'}>Membership governance</button></section>
  `;
}

function renderPolicies(): string {
  const safe = state.safe;
  const policy = state.bootstrap?.policy;
  return `
    ${pageHeader('Policies', 'Treasury rules are enforced by the Safe contract. Private policy mode commits to rules without publishing them.', `<button class="primary-button" data-action="open-governance" ${safe ? '' : 'disabled'}>Change policy</button>`)}
    <div class="policy-grid">
      ${policyCard('Approval policy', safe?.policyMode === 'PRIVATE_POLICY' ? 'Private policy' : safe ? 'Standard' : 'Not configured', safe?.policyMode === 'PRIVATE_POLICY' ? 'Threshold stays private.' : safe?.publicQuorum ? `${safe.publicQuorum} approvals required.` : 'Create or attach a Safe.')}
      ${policyCard('Transfer limit', policy ? (policy.max_transfer_amount === 0n ? 'Unlimited' : policy.max_transfer_amount.toString()) : 'Private / unavailable', 'Exact limit is only shown while its private opening is in memory.')}
      ${policyCard('Proposal lifetime', policy ? `${policy.max_proposal_lifetime.toString()} sec` : 'Private / unavailable', 'Maximum time a proposal may remain valid.')}
      ${policyCard('Execution delay', policy ? `${policy.min_execution_delay.toString()} sec` : 'Private / unavailable', 'Minimum delay before eligible execution.')}
    </div>
    <section class="surface">
      <div class="surface-head"><div><h2>Governance controls</h2><span>Every sensitive change follows the private proposal + quorum path</span></div></div>
      <div class="governance-cards">
        ${governanceTile('Pause Safe', 'Emergency stop controlled by quorum.', 'PAUSE')}
        ${governanceTile('Resume Safe', 'Resume after an approved pause.', 'RESUME')}
        ${governanceTile('Rotate members', 'Replace the authorization root.', 'ROTATE_MEMBERSHIP')}
        ${governanceTile('Change policy', 'Commit to a new treasury policy.', 'CHANGE_POLICY')}
      </div>
    </section>
  `;
}

function renderActivity(): string {
  return `
    ${pageHeader('Activity', 'Transaction IDs and public metadata stored locally in this browser.', `<button class="secondary-button" data-action="clear-activity">Clear local log</button>`)}
    <section class="surface transaction-surface">
      ${state.activity.length ? `<div class="transaction-list">${state.activity.map(renderActivityRow).join('')}</div>` : renderEmpty('No public activity', 'Private signer material and proposal payloads are never written to this log.')}
    </section>
  `;
}

function renderSecurity(): string {
  const checks: Array<[string, string, boolean]> = [
    ['Supported wallets', 'Lace + 1AM allowlist', true],
    ['Network lock', 'Midnight Preview only', true],
    ['Account switching', 'Session invalidates on mutation', true],
    ['Private state', 'Scoped to active wallet session', true],
    ['ZK artifacts', 'Same-origin + pinned build path', true],
    ['Approvals', 'Duplicate/replay nullifiers', true],
    ['Admin access', 'No master withdrawal key', true],
    ['Safe deployment', state.safe ? 'Attached in this browser' : 'Pending', Boolean(state.safe)],
    ['On-chain verification', state.safe?.deploymentVerifiedOnChain ? 'Verified' : 'Pending', Boolean(state.safe?.deploymentVerifiedOnChain)],
    ['Multi-wallet live run', '3+ independent signers', false],
    ['Receipt verification', 'BLACKOUT Verify end-to-end', false],
  ];
  return `
    ${pageHeader('Security', 'Fail-closed controls around the zero-knowledge treasury runtime.')}
    <section class="security-hero"><div class="shield-icon">✓</div><div><strong>Private by construction</strong><p>The product hides protocol complexity, not security state. Runtime claims remain pending until there is real Preview evidence.</p></div><span class="preview-lock">PREVIEW ONLY</span></section>
    <section class="surface"><div class="security-list">${checks.map(([label, detail, done]) => `<div class="security-row"><span class="security-check ${done ? 'done' : ''}">${done ? '✓' : '·'}</span><div><strong>${h(label)}</strong><span>${h(detail)}</span></div><span class="security-state ${done ? 'done' : ''}">${done ? 'Ready' : 'Pending'}</span></div>`).join('')}</div></section>
    <div class="notice danger"><strong>Mainnet remains disabled.</strong><span>This build is hard-locked to Midnight Preview and never auto-promotes itself to production.</span></div>
  `;
}

function renderSettings(): string {
  const safe = state.safe;
  return `
    ${pageHeader('Settings', 'Safe management and advanced protocol information.', `<button class="secondary-button" data-action="open-attach">Attach existing Safe</button>`)}
    <section class="surface settings-section">
      <div class="surface-head"><div><h2>Wallet & network</h2><span>Execution session</span></div></div>
      <div class="settings-row"><div><strong>Network</strong><span>Midnight Preview</span></div><span class="status-chip verified">Locked</span></div>
      <div class="settings-row"><div><strong>Wallet</strong><span>${state.wallet ? h(state.wallet.walletName) : 'No wallet connected'}</span></div><button class="text-button" data-action="${state.wallet ? 'disconnect-wallet' : 'open-wallet'}">${state.wallet ? 'Disconnect' : 'Connect'}</button></div>
      <div class="settings-row"><div><strong>Refresh wallet state</strong><span>Re-read current DUST and shielded keys from the active wallet.</span></div><button class="text-button" data-action="refresh-wallet" ${state.wallet ? '' : 'disabled'}>Refresh</button></div>
    </section>

    <section class="surface settings-section">
      <div class="surface-head"><div><h2>Advanced Safe details</h2><span>Protocol data normal users should not need every day</span></div></div>
      ${safe ? `<div class="advanced-grid">
        ${advancedField('Contract address', safe.contractAddress)}
        ${advancedField('Deployment transaction', safe.deploymentTxId)}
        ${advancedField('Safe ID', safe.safeId)}
        ${advancedField('Membership root', safe.membershipRoot)}
        ${advancedField('Policy commitment', safe.policyCommitment)}
        ${advancedField('Versions', `Membership ${safe.membershipVersion} · Policy ${safe.policyVersion}`)}
      </div>` : renderEmpty('No Safe attached', 'Advanced protocol details appear after a real Preview Safe is created or attached.')}
    </section>

    <section class="surface settings-section">
      <div class="surface-head"><div><h2>Proof receipts</h2><span>Advanced · BLACKOUT Verify boundary</span></div></div>
      <div class="friendly-form two-col">
        <label><span>Statement</span><select id="receipt-type"><option value="receipt_quorum_authorized">Quorum authorized</option><option value="receipt_executed_exactly_once">Executed exactly once</option><option value="receipt_disclose_amount">Disclose amount</option><option value="receipt_disclose_recipient">Disclose recipient</option><option value="receipt_proposal_cancelled">Proposal cancelled</option></select></label>
        <label><span>Proposal commitment</span><input id="receipt-commitment" placeholder="0x…" autocomplete="off"></label>
        <label class="full"><span>Policy opening JSON · when required</span><textarea id="receipt-policy" autocomplete="off"></textarea></label>
        <label class="full"><span>Proposal bundle JSON · when required</span><textarea id="receipt-proposal" autocomplete="off"></textarea></label>
      </div>
      <div class="form-footer"><p>Proof transactions are real. Verify-side packaging remains a separate integration boundary.</p><button class="secondary-button" data-action="run-receipt" ${safe ? '' : 'disabled'}>Generate proof transaction</button></div>
    </section>
  `;
}

function policyCard(label: string, value: string, detail: string): string {
  return `<section class="policy-card"><span>${h(label)}</span><strong>${h(value)}</strong><p>${h(detail)}</p></section>`;
}

function governanceTile(title: string, detail: string, action: GovernanceAction): string {
  return `<button class="governance-tile" data-action="open-governance" data-governance="${action}" ${state.safe ? '' : 'disabled'}><strong>${h(title)}</strong><span>${h(detail)}</span><em>Configure →</em></button>`;
}

function advancedField(label: string, value: string): string {
  return `<div class="advanced-field"><span>${h(label)}</span><code>${h(value)}</code></div>`;
}

function healthRow(label: string, value: string, ok: boolean): string {
  return `<div class="health-row"><span class="health-dot ${ok ? 'ok' : ''}"></span><span>${h(label)}</span><strong>${h(value)}</strong></div>`;
}

function renderActivityRow(item: ActivityItem): string {
  const labelMap: Record<string, string> = {
    DEPLOY: 'Safe created', DEPOSIT: 'Deposit', PROPOSE: 'Transaction proposed', APPROVE: 'Approval submitted', QUORUM: 'Quorum proved', EXECUTE_TRANSFER: 'Transfer executed', GOV_PROPOSE: 'Governance proposed', GOV_EXECUTE: 'Governance executed', RECEIPT: 'Proof receipt',
  };
  return `<div class="transaction-row"><div class="tx-icon">${item.type === 'APPROVE' || item.type === 'QUORUM' ? '✓' : item.type.includes('EXECUTE') ? '↗' : '•'}</div><div class="tx-main"><strong>${h(labelMap[item.type] ?? item.type)}</strong><span>${h(new Date(item.at).toLocaleString())}</span></div><div class="tx-detail"><strong>${h(short(item.txId, 10, 8))}</strong><span>${h(short(item.detail, 18, 12))}</span></div></div>`;
}

function renderEmpty(title: string, detail: string, action?: string, actionLabel?: string, disabled = false): string {
  return `<div class="empty-state"><div class="empty-orb">B</div><strong>${h(title)}</strong><p>${h(detail)}</p>${action && actionLabel ? `<button class="secondary-button" data-action="${action}" ${disabled ? 'disabled' : ''}>${h(actionLabel)}</button>` : ''}</div>`;
}

function renderModal(): string {
  switch (state.modal) {
    case 'wallet': return renderWalletModal();
    case 'bootstrap': return renderBootstrapModal();
    case 'attach': return renderAttachModal();
    case 'new-transaction': return renderNewTransactionModal();
    case 'receive': return renderReceiveModal();
    case 'approve': return renderApproveModal();
    case 'quorum': return renderQuorumModal();
    case 'execute': return renderExecuteModal();
    case 'governance': return renderGovernanceModal();
    default: return '';
  }
}

function modalShell(title: string, subtitle: string, body: string, wide = false): string {
  return `<div class="modal-backdrop"><div class="product-modal ${wide ? 'wide' : ''}"><div class="modal-header"><div><h2>${h(title)}</h2><p>${h(subtitle)}</p></div><button class="modal-close" data-action="close-modal">×</button></div><div class="modal-content">${body}</div></div></div>`;
}

function renderWalletModal(): string {
  return modalShell('Connect wallet', 'BLACKOUT SAFE supports approved Midnight Preview wallets only.', `
    <div class="wallet-options">
      <button class="wallet-option" data-action="connect-lace"><div class="wallet-logo lace-logo">L</div><div><strong>Lace</strong><span>Midnight DApp Connector · Preview</span></div><em>Connect</em></button>
      <button class="wallet-option" data-action="connect-1am"><div class="wallet-logo oneam-logo">1A</div><div><strong>1AM</strong><span>Sponsored Preview execution supported</span></div><em>Connect</em></button>
    </div>
    <div class="modal-note">Wallet discovery waits for extension injection and remains fail-closed. If both supported extensions are active simultaneously, the current runtime asks you to leave only the wallet you want enabled.</div>
  `);
}

function renderBootstrapModal(): string {
  const bootstrap = state.bootstrap;
  return modalShell('Create BLACKOUT SAFE', 'Set the private authorization policy, export signer kits, then deploy to Midnight Preview.', `
    <div class="step-strip"><span class="active">1 · Policy</span><span class="${bootstrap ? 'active' : ''}">2 · Signers</span><span>3 · Deploy</span></div>
    <div class="friendly-form two-col">
      <label><span>Authorized members</span><input id="boot-members" value="5" inputmode="numeric"></label>
      <label><span>Approval threshold</span><input id="boot-threshold" value="3" inputmode="numeric"></label>
      <label><span>Policy visibility</span><select id="boot-mode"><option value="PRIVATE_POLICY">Private policy</option><option value="STANDARD">Standard / public threshold</option></select></label>
      <label><span>Max transfer · 0 = unlimited</span><input id="boot-max-transfer" value="0" inputmode="numeric"></label>
      <label><span>Max proposal lifetime · seconds</span><input id="boot-lifetime" value="86400" inputmode="numeric"></label>
      <label><span>Execution delay · seconds</span><input id="boot-delay" value="0" inputmode="numeric"></label>
    </div>
    <div class="form-footer"><p>Signer secrets are generated locally and never persisted by the app.</p><button class="primary-button" data-action="generate-bootstrap">Generate private setup</button></div>
    ${bootstrap ? `<div class="generated-box"><div class="generated-head"><div><strong>Private signer set ready</strong><span>Export every signer kit before refreshing this page.</span></div><span class="live-pill">In memory only</span></div>
      <div class="signer-export-list">${bootstrap.membership.kits.map((kit, i) => `<div class="signer-export"><div class="member-avatar">${i + 1}</div><div><strong>Signer ${i + 1}</strong><span>${h(short(kit.memberCommitment, 14, 10))}</span></div><button class="secondary-button compact" data-action="download-signer" data-index="${i}">Export</button></div>`).join('')}</div>
      <div class="signer-export"><div class="member-avatar policy-avatar">P</div><div><strong>Policy opening</strong><span>Required for private policy proofs.</span></div><button class="secondary-button compact" data-action="download-policy">Export</button></div>
      <div class="deploy-row"><div><span>Safe ID</span><code>${h(short(bytesToHex32(bootstrap.membership.safeId), 18, 12))}</code></div><button class="primary-button" data-action="deploy-bootstrap" ${state.wallet ? '' : 'disabled'}>${state.busy === 'deploy' ? 'Deploying…' : 'Deploy Preview Safe'}</button></div>
      ${!state.wallet ? '<button class="secondary-button full-button" data-action="open-wallet">Connect wallet before deployment</button>' : ''}
    </div>` : ''}
  `, true);
}

function renderAttachModal(): string {
  return modalShell('Attach existing Safe', 'Import public Preview deployment metadata. This does not mark the contract independently verified.', `
    <div class="friendly-form two-col advanced-form">
      <label class="full"><span>Contract address</span><input id="attach-contract" placeholder="64-hex / 0x / 0200 form" autocomplete="off"></label>
      <label class="full"><span>Deployment transaction ID</span><input id="attach-tx" placeholder="64-hex transaction ID" autocomplete="off"></label>
      <label><span>Block height</span><input id="attach-block" value="0" inputmode="numeric"></label>
      <label><span>Policy mode</span><select id="attach-mode"><option value="PRIVATE_POLICY">Private policy</option><option value="STANDARD">Standard</option></select></label>
      <label class="full"><span>Safe ID</span><input id="attach-safe-id" placeholder="0x…" autocomplete="off"></label>
      <label class="full"><span>Membership root</span><input id="attach-root" placeholder="0x…" autocomplete="off"></label>
      <label class="full"><span>Policy commitment</span><input id="attach-policy" placeholder="0x…" autocomplete="off"></label>
      <label><span>Membership version</span><input id="attach-membership-version" value="1"></label>
      <label><span>Policy version</span><input id="attach-policy-version" value="1"></label>
      <label><span>Public quorum · Standard only</span><input id="attach-quorum" placeholder="3"></label>
    </div>
    <div class="form-footer"><p>On-chain verification remains false until a trusted network verifier confirms it.</p><button class="primary-button" data-action="attach-safe">Attach Safe</button></div>
  `, true);
}

function renderNewTransactionModal(): string {
  return modalShell('New transaction', 'Create a private shielded transfer proposal.', `
    <div class="transaction-wizard-intro"><div class="wizard-step active"><span>1</span><strong>Transfer</strong></div><div class="wizard-line"></div><div class="wizard-step"><span>2</span><strong>Approvals</strong></div><div class="wizard-line"></div><div class="wizard-step"><span>3</span><strong>Execute</strong></div></div>
    <div class="friendly-form two-col">
      <label><span>Asset color</span><input id="proposal-asset" value="${ZERO32}" autocomplete="off"></label>
      <label><span>Recipient shielded coin public key</span><input id="proposal-recipient" placeholder="0x…" autocomplete="off"></label>
      <label><span>Amount · base units</span><input id="proposal-amount" placeholder="1000000" inputmode="numeric"></label>
      <label><span>Proposal lifetime · seconds</span><input id="proposal-lifetime" value="3600" inputmode="numeric"></label>
      <label class="full"><span>Memo hash · optional</span><input id="proposal-memo" placeholder="Leave blank for an opaque random commitment" autocomplete="off"></label>
    </div>
    <details class="advanced-disclosure"><summary>Authorization material</summary><div class="friendly-form"><label><span>Signer kit JSON</span><textarea id="proposal-signer" placeholder="Paste one exported signer kit" autocomplete="off"></textarea></label><label><span>Policy opening JSON</span><textarea id="proposal-policy" placeholder="Paste the matching policy opening" autocomplete="off"></textarea></label></div></details>
    <div class="form-footer"><p>Recipient, amount and memo are committed into the private proposal path rather than displayed as public treasury intelligence.</p><button class="primary-button" data-action="create-proposal">Create private transaction</button></div>
  `, true);
}

function renderReceiveModal(): string {
  return modalShell('Receive assets', 'Fund the attached BLACKOUT SAFE with a real shielded deposit.', `
    ${state.safe ? `<div class="receive-address"><span>Safe contract</span><code>${h(state.safe.contractAddress)}</code></div>` : '<div class="modal-note danger">Create or attach a Safe first.</div>'}
    <div class="friendly-form two-col"><label><span>Asset color / token type</span><input id="deposit-color" value="${ZERO32}" autocomplete="off"></label><label><span>Amount · base units</span><input id="deposit-value" placeholder="1000000" inputmode="numeric"></label></div>
    <div class="form-footer"><p>BLACKOUT SAFE will not show a synthetic portfolio balance after deposit.</p><button class="primary-button" data-action="deposit" ${state.safe && state.wallet ? '' : 'disabled'}>Deposit</button></div>
  `);
}

function renderApproveModal(): string {
  return modalShell('Approve transaction', 'Submit one anonymous authorized approval.', `
    <div class="friendly-form"><label><span>Proposal commitment</span><input id="approve-commitment" placeholder="0x…" autocomplete="off"></label><label><span>Signer kit JSON</span><textarea id="approve-signer" placeholder="Use a distinct authorized signer" autocomplete="off"></textarea></label><details class="advanced-disclosure"><summary>Paused-Safe governance bundle · optional</summary><label><span>Proposal bundle JSON</span><textarea id="approve-proposal" autocomplete="off"></textarea></label></details></div>
    <div class="form-footer"><p>The member proves authorization without publishing their identity. Duplicate approvals are rejected.</p><button class="primary-button" data-action="approve-proposal">Approve privately</button></div>
  `);
}

function renderQuorumModal(): string {
  return modalShell('Prove quorum', 'Prove that the required number of distinct authorized members approved.', `
    <div class="friendly-form"><label><span>Proposal commitment</span><input id="quorum-commitment" placeholder="0x…" autocomplete="off"></label><label><span>Policy opening JSON</span><textarea id="quorum-policy" autocomplete="off"></textarea></label></div>
    <div class="form-footer"><p>The resulting proof establishes policy satisfaction without revealing signer identities.</p><button class="primary-button" data-action="prove-quorum">Prove quorum</button></div>
  `);
}

function renderExecuteModal(): string {
  return modalShell('Execute transfer', 'Final shielded transfer execution after quorum.', `
    <div class="modal-note danger"><strong>Real held coin required.</strong> Coin discovery is not yet automated, so execution needs the actual Preview held-coin opening.</div>
    <div class="friendly-form"><label><span>Policy opening JSON</span><textarea id="exec-policy" autocomplete="off"></textarea></label><label><span>Private proposal bundle JSON</span><textarea id="exec-proposal" autocomplete="off"></textarea></label><label><span>Held coin opening JSON</span><textarea id="exec-held-coin" placeholder='{"nonce":"0x...","color":"0x...","value":"1000000","mt_index":"0"}' autocomplete="off"></textarea></label></div>
    <div class="form-footer"><p>Execution remains fail-closed if any required private opening is unavailable or inconsistent.</p><button class="primary-button" data-action="execute-transfer">Execute transfer</button></div>
  `, true);
}

function renderGovernanceModal(): string {
  return modalShell('Governance', 'Create or execute a quorum-gated treasury governance action.', `
    <div class="governance-modal-grid">
      <section><h3>Create proposal</h3><div class="friendly-form"><label><span>Action</span><select id="gov-create-action"><option>PAUSE</option><option>RESUME</option><option>CANCEL_PROPOSAL</option><option>ROTATE_MEMBERSHIP</option><option>CHANGE_POLICY</option></select></label><label><span>Lifetime · seconds</span><input id="gov-create-lifetime" value="3600"></label><label><span>Signer kit JSON</span><textarea id="gov-create-signer"></textarea></label><label><span>Current policy opening</span><textarea id="gov-create-policy"></textarea></label><label><span>Cancel target · optional</span><input id="gov-create-target" placeholder="0x…"></label><label><span>New membership root · optional</span><input id="gov-create-root" placeholder="0x…"></label><label><span>Next policy opening · optional</span><textarea id="gov-create-next-policy"></textarea></label></div><button class="secondary-button full-button" data-action="create-governance">Create governance proposal</button></section>
      <section><h3>Execute approved action</h3><div class="friendly-form"><label><span>Action</span><select id="gov-exec-action"><option>PAUSE</option><option>RESUME</option><option>CANCEL_PROPOSAL</option><option>ROTATE_MEMBERSHIP</option><option>CHANGE_POLICY</option></select></label><label><span>Proposal bundle</span><textarea id="gov-exec-proposal"></textarea></label><label><span>Current policy opening</span><textarea id="gov-exec-policy"></textarea></label><label><span>Cancel target · optional</span><input id="gov-exec-target" placeholder="0x…"></label><label><span>New membership root · optional</span><input id="gov-exec-root" placeholder="0x…"></label><label><span>Next policy opening · optional</span><textarea id="gov-exec-next-policy"></textarea></label></div><button class="danger-button full-button" data-action="execute-governance">Execute governance</button></section>
    </div>
  `, true);
}

function renderToasts(): string {
  return `<div class="toast-stack">${state.toasts.map((item) => `<div class="toast ${item.type}">${h(item.message)}</div>`).join('')}</div>`;
}

function render(): void {
  app.innerHTML = renderShell();
}

async function connectSelectedWallet(expected: 'lace' | '1am'): Promise<void> {
  const result = await runBusy('wallet', connectWallet);
  if (!result) return;
  const descriptor = `${result.walletName} ${result.connectorId}`.toLowerCase();
  const matches = expected === 'lace' ? descriptor.includes('lace') : descriptor.includes('1am');
  if (!matches) {
    disconnectWallet();
    state.wallet = null;
    toast(expected === 'lace' ? 'BLACKOUT_SAFE_LACE_NOT_SELECTED' : 'BLACKOUT_SAFE_1AM_NOT_SELECTED', 'error');
    return;
  }
  state.wallet = result;
  state.modal = null;
  toast(`${result.walletName} connected on Midnight Preview.`, 'success');
}

async function handleAction(action: string, button: HTMLElement): Promise<void> {
  switch (action) {
    case 'open-wallet': state.modal = 'wallet'; break;
    case 'connect-lace': await connectSelectedWallet('lace'); break;
    case 'connect-1am': await connectSelectedWallet('1am'); break;
    case 'disconnect-wallet': disconnectWallet(); state.wallet = null; toast('Wallet session cleared.'); break;
    case 'refresh-wallet': {
      const result = await runBusy('wallet', refreshWallet);
      if (result) { state.wallet = result; toast('Wallet state refreshed.', 'success'); }
      break;
    }
    case 'open-bootstrap': state.modal = 'bootstrap'; state.bootstrap = null; break;
    case 'open-attach': state.modal = 'attach'; break;
    case 'open-new-transaction': state.modal = 'new-transaction'; break;
    case 'open-receive': state.modal = 'receive'; break;
    case 'open-approve': state.modal = 'approve'; break;
    case 'open-quorum': state.modal = 'quorum'; break;
    case 'open-execute': state.modal = 'execute'; break;
    case 'open-governance': state.modal = 'governance'; break;
    case 'close-modal': state.modal = null; break;
    case 'generate-bootstrap': {
      try {
        state.bootstrap = bootstrapSafe({
          memberCount: Number(asBigInt(inputValue('boot-members'), 'BLACKOUT_SAFE_MEMBER_COUNT', false)),
          mode: inputValue('boot-mode') as 'STANDARD' | 'PRIVATE_POLICY',
          threshold: asBigInt(inputValue('boot-threshold'), 'BLACKOUT_SAFE_THRESHOLD', false),
          maxTransferAmount: asBigInt(inputValue('boot-max-transfer'), 'BLACKOUT_SAFE_MAX_TRANSFER'),
          maxProposalLifetime: asBigInt(inputValue('boot-lifetime'), 'BLACKOUT_SAFE_MAX_LIFETIME', false),
          minExecutionDelay: asBigInt(inputValue('boot-delay'), 'BLACKOUT_SAFE_EXECUTION_DELAY'),
        });
        toast('Private signer set generated. Export signer kits before deployment.', 'success');
      } catch (error) { toast(errorMessage(error), 'error'); }
      break;
    }
    case 'download-signer': {
      if (!state.bootstrap) break;
      const index = Number(button.dataset.index ?? '-1');
      const kit = state.bootstrap.membership.kits[index];
      if (!kit) throw new Error('BLACKOUT_SAFE_SIGNER_KIT_NOT_FOUND');
      downloadJson(`blackout-safe-signer-${index + 1}.json`, kit);
      break;
    }
    case 'download-policy': if (state.bootstrap) downloadJson('blackout-safe-policy-opening.json', state.bootstrap.policyOpening); break;
    case 'deploy-bootstrap': {
      if (!state.bootstrap) { toast('Generate the private setup first.', 'error'); break; }
      const deployed = await runBusy('deploy', () => deployBootstrap(state.bootstrap!));
      if (deployed) {
        state.safe = deployed;
        savePublicState();
        addActivity('DEPLOY', { txId: deployed.deploymentTxId }, `block ${deployed.deploymentBlockHeight}`);
        downloadJson('blackout-safe-public-manifest.json', deployed);
        state.modal = null;
        state.view = 'dashboard';
        toast('Preview Safe deployment submitted. Independent on-chain verification is still pending.', 'success');
      }
      break;
    }
    case 'attach-safe': {
      try {
        const mode = inputValue('attach-mode') as 'STANDARD' | 'PRIVATE_POLICY';
        state.safe = attachExistingSafe({
          safeId: inputValue('attach-safe-id') as Hex32String,
          membershipRoot: inputValue('attach-root') as Hex32String,
          membershipVersion: inputValue('attach-membership-version'),
          policyCommitment: inputValue('attach-policy') as Hex32String,
          policyVersion: inputValue('attach-policy-version'),
          policyMode: mode,
          publicQuorum: mode === 'STANDARD' ? inputValue('attach-quorum') : null,
          contractAddress: inputValue('attach-contract'),
          deploymentTxId: inputValue('attach-tx'),
          deploymentBlockHeight: Number(inputValue('attach-block')),
          deploymentVerifiedOnChain: false,
        });
        savePublicState();
        state.modal = null;
        toast('Preview Safe attached. Network verification remains pending.', 'success');
      } catch (error) { toast(errorMessage(error), 'error'); }
      break;
    }
    case 'deposit': {
      const result = await runBusy('deposit', () => depositShielded(requireSafe(), inputValue('deposit-color') as Hex32String, asBigInt(inputValue('deposit-value'), 'BLACKOUT_SAFE_DEPOSIT_VALUE', false)));
      if (result) { addActivity('DEPOSIT', result, `block ${result.blockHeight}`); state.modal = null; toast('Shielded deposit submitted.', 'success'); }
      break;
    }
    case 'create-proposal': {
      const result = await runBusy('create-proposal', () => createTransferProposal({
        safe: requireSafe(),
        signerKit: parseJsonInput<SerializedSafeSignerKit>('proposal-signer', 'BLACKOUT_SAFE_SIGNER_KIT'),
        policyOpening: parseJsonInput<SerializedPolicyOpening>('proposal-policy', 'BLACKOUT_SAFE_POLICY_OPENING'),
        asset: inputValue('proposal-asset') as Hex32String,
        recipientCoinPublicKey: inputValue('proposal-recipient') as Hex32String,
        amount: asBigInt(inputValue('proposal-amount'), 'BLACKOUT_SAFE_AMOUNT', false),
        memoHash: inputValue('proposal-memo') ? inputValue('proposal-memo') as Hex32String : undefined,
        lifetimeSeconds: asBigInt(inputValue('proposal-lifetime'), 'BLACKOUT_SAFE_LIFETIME', false),
      }));
      if (result) {
        addActivity('PROPOSE', result.tx, result.proposalBundle.proposalCommitment);
        downloadJson(`blackout-safe-proposal-${result.proposalBundle.proposalCommitment.slice(2, 10)}.json`, result.proposalBundle);
        state.modal = null;
        toast('Private transaction created. Proposal bundle downloaded.', 'success');
      }
      break;
    }
    case 'approve-proposal': {
      const bundle = inputValue('approve-proposal');
      const result = await runBusy('approve-proposal', () => approveProposal({
        safe: requireSafe(),
        signerKit: parseJsonInput<SerializedSafeSignerKit>('approve-signer', 'BLACKOUT_SAFE_SIGNER_KIT'),
        proposalCommitment: inputValue('approve-commitment') as Hex32String,
        proposalBundle: bundle ? JSON.parse(bundle) as SerializedProposalBundle : undefined,
      }));
      if (result) { addActivity('APPROVE', result, inputValue('approve-commitment')); state.modal = null; toast('Private approval submitted.', 'success'); }
      break;
    }
    case 'prove-quorum': {
      const commitment = inputValue('quorum-commitment') as Hex32String;
      const result = await runBusy('prove-quorum', () => proveQuorum({ safe: requireSafe(), policyOpening: parseJsonInput<SerializedPolicyOpening>('quorum-policy', 'BLACKOUT_SAFE_POLICY_OPENING'), proposalCommitment: commitment }));
      if (result) { addActivity('QUORUM', result, commitment); state.modal = null; toast('Quorum proof submitted.', 'success'); }
      break;
    }
    case 'execute-transfer': {
      const result = await runBusy('execute-transfer', () => executeTransfer({
        safe: requireSafe(),
        policyOpening: parseJsonInput<SerializedPolicyOpening>('exec-policy', 'BLACKOUT_SAFE_POLICY_OPENING'),
        proposalBundle: parseJsonInput<SerializedProposalBundle>('exec-proposal', 'BLACKOUT_SAFE_PROPOSAL_BUNDLE'),
        heldCoin: parseJsonInput('exec-held-coin', 'BLACKOUT_SAFE_HELD_COIN'),
      }));
      if (result) { addActivity('EXECUTE_TRANSFER', result, `block ${result.blockHeight}`); state.modal = null; toast('Shielded transfer execution submitted.', 'success'); }
      break;
    }
    case 'create-governance': {
      const actionName = inputValue('gov-create-action') as GovernanceAction;
      const next = inputValue('gov-create-next-policy');
      const result = await runBusy('create-governance', () => createGovernanceProposal({
        safe: requireSafe(),
        signerKit: parseJsonInput('gov-create-signer', 'BLACKOUT_SAFE_SIGNER_KIT'),
        policyOpening: parseJsonInput('gov-create-policy', 'BLACKOUT_SAFE_POLICY_OPENING'),
        action: actionName,
        lifetimeSeconds: asBigInt(inputValue('gov-create-lifetime'), 'BLACKOUT_SAFE_LIFETIME', false),
        targetProposal: inputValue('gov-create-target') ? inputValue('gov-create-target') as Hex32String : undefined,
        newMembershipRoot: inputValue('gov-create-root') ? inputValue('gov-create-root') as Hex32String : undefined,
        nextPolicy: next ? JSON.parse(next) as SerializedPolicyOpening : undefined,
      }));
      if (result) {
        addActivity('GOV_PROPOSE', result.tx, `${actionName} · ${result.proposalBundle.proposalCommitment}`);
        downloadJson(`blackout-safe-governance-${actionName.toLowerCase()}.json`, result.proposalBundle);
        toast('Governance proposal submitted.', 'success');
      }
      break;
    }
    case 'execute-governance': {
      const actionName = inputValue('gov-exec-action') as GovernanceAction;
      const next = inputValue('gov-exec-next-policy');
      const result = await runBusy('execute-governance', () => executeGovernance({
        safe: requireSafe(),
        action: actionName,
        policyOpening: parseJsonInput('gov-exec-policy', 'BLACKOUT_SAFE_POLICY_OPENING'),
        proposalBundle: parseJsonInput('gov-exec-proposal', 'BLACKOUT_SAFE_PROPOSAL_BUNDLE'),
        targetProposal: inputValue('gov-exec-target') ? inputValue('gov-exec-target') as Hex32String : undefined,
        newMembershipRoot: inputValue('gov-exec-root') ? inputValue('gov-exec-root') as Hex32String : undefined,
        nextPolicy: next ? JSON.parse(next) as SerializedPolicyOpening : undefined,
      }));
      if (result) { addActivity('GOV_EXECUTE', result, actionName); state.modal = null; toast(`${actionName} execution submitted.`, 'success'); }
      break;
    }
    case 'run-receipt': {
      const policy = inputValue('receipt-policy');
      const proposal = inputValue('receipt-proposal');
      const result = await runBusy('run-receipt', () => runReceiptCircuit({
        safe: requireSafe(),
        circuitId: inputValue('receipt-type') as any,
        proposalCommitment: inputValue('receipt-commitment') as Hex32String,
        policyOpening: policy ? JSON.parse(policy) as SerializedPolicyOpening : undefined,
        proposalBundle: proposal ? JSON.parse(proposal) as SerializedProposalBundle : undefined,
      }));
      if (result) { addActivity('RECEIPT', result, inputValue('receipt-type')); toast('Proof receipt transaction submitted.', 'success'); }
      break;
    }
    case 'clear-activity': state.activity = []; savePublicState(); toast('Local public activity cleared.'); break;
  }
  render();
}

document.addEventListener('click', (event) => {
  const target = event.target as Element | null;
  const viewTarget = target?.closest<HTMLElement>('[data-view]');
  if (viewTarget?.dataset.view) {
    const view = viewTarget.dataset.view as View;
    if (validViews.includes(view)) {
      state.view = view;
      state.modal = null;
      location.hash = `#/${view}`;
      render();
      return;
    }
  }
  const actionTarget = target?.closest<HTMLElement>('[data-action]');
  if (actionTarget?.dataset.action) void handleAction(actionTarget.dataset.action, actionTarget);
});

window.addEventListener('hashchange', () => {
  const view = location.hash.replace('#/', '') as View;
  if (validViews.includes(view)) state.view = view;
  render();
});

render();
