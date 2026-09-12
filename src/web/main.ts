import './styles.css';
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

type View = 'overview' | 'treasury' | 'proposals' | 'governance' | 'receipts' | 'security';
type Modal = 'bootstrap' | 'attach' | null;

interface Activity {
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
  activity: Activity[];
  busy: string | null;
  toasts: Array<{ id: number; type: 'success' | 'error' | 'info'; message: string }>;
}

const state: AppState = {
  view: (location.hash.replace('#/', '') as View) || 'overview',
  modal: null,
  wallet: null,
  safe: loadJson<PublicSafeRecord>(SAFE_KEY),
  bootstrap: null,
  activity: loadJson<Activity[]>(ACTIVITY_KEY) ?? [],
  busy: null,
  toasts: [],
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('BLACKOUT_SAFE_APP_ROOT_MISSING');

function loadJson<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

function savePublicState(): void {
  if (state.safe) localStorage.setItem(SAFE_KEY, JSON.stringify(state.safe));
  else localStorage.removeItem(SAFE_KEY);
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(state.activity.slice(0, 80)));
}

function h(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function short(value?: string | null, left = 10, right = 8): string {
  if (!value) return '—';
  return value.length <= left + right + 3 ? value : `${value.slice(0, left)}…${value.slice(-right)}`;
}

function inputValue(id: string): string {
  const element = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (!element) throw new Error(`BLACKOUT_SAFE_INPUT_MISSING_${id}`);
  return element.value.trim();
}

function checked(id: string): boolean {
  const element = document.getElementById(id) as HTMLInputElement | null;
  return Boolean(element?.checked);
}

function parseJsonInput<T>(id: string, label: string): T {
  const raw = inputValue(id);
  if (!raw) throw new Error(`${label}_REQUIRED`);
  try {
    return JSON.parse(raw) as T;
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

function toast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  state.toasts.push({ id, type, message });
  render();
  window.setTimeout(() => {
    state.toasts = state.toasts.filter((item) => item.id !== id);
    render();
  }, 5200);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'BLACKOUT_SAFE_UNKNOWN_ERROR';
}

function addActivity(type: string, tx: TxResultView | { txId: string }, detail: string): void {
  state.activity.unshift({ at: new Date().toISOString(), type, txId: tx.txId, detail });
  state.activity = state.activity.slice(0, 80);
  savePublicState();
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function runBusy<T>(label: string, operation: () => Promise<T>): Promise<T | null> {
  if (state.busy) return null;
  state.busy = label;
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

function requireSafe(): PublicSafeRecord {
  if (!state.safe) throw new Error('BLACKOUT_SAFE_ATTACH_OR_DEPLOY_SAFE_FIRST');
  return state.safe;
}

function navItem(view: View, index: string, label: string): string {
  return `<button class="nav-btn ${state.view === view ? 'active' : ''}" data-view="${view}"><span>${h(label)}</span><span class="nav-index">${index}</span></button>`;
}

function renderShell(): string {
  const walletConnected = Boolean(state.wallet);
  const safeAttached = Boolean(state.safe);
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark"></div>
          <div><div class="brand-name">BLACKOUT SAFE</div><div class="brand-sub mono">ZERO-KNOWLEDGE TREASURY OS</div></div>
        </div>
        <nav class="nav">
          ${navItem('overview', '01', 'Overview')}
          ${navItem('treasury', '02', 'Treasury')}
          ${navItem('proposals', '03', 'Proposals')}
          ${navItem('governance', '04', 'Governance')}
          ${navItem('receipts', '05', 'Receipts')}
          ${navItem('security', '06', 'Security')}
        </nav>
        <div class="sidebar-foot">
          <div class="status-row"><span class="dot green"></span><span class="micro">MIDNIGHT / PREVIEW</span></div>
          <div class="status-row"><span class="dot ${walletConnected ? 'green' : 'amber'}"></span><span class="micro">LACE ${walletConnected ? 'CONNECTED' : 'DISCONNECTED'}</span></div>
          <div class="status-row"><span class="dot ${safeAttached ? 'green' : 'amber'}"></span><span class="micro">SAFE ${safeAttached ? 'ATTACHED' : 'NOT ATTACHED'}</span></div>
          <div class="micro">COMPACT 0.31.1<br>RUNTIME 0.16.0<br>MIDNIGHTJS 4.1.1</div>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="topbar-title">${h(state.view)} / PREVIEW</div>
          <div class="topbar-meta">
            <span class="badge">15 ZK CIRCUITS</span>
            <span class="badge green">PREVIEW ONLY</span>
            ${state.safe ? `<span class="badge">${h(short(state.safe.contractAddress))}</span>` : '<span class="badge red">NO SAFE</span>'}
            <button class="button small ${walletConnected ? 'ghost' : 'primary'}" data-action="${walletConnected ? 'disconnect-wallet' : 'connect-wallet'}">${state.busy === 'wallet' ? '<span class="loader"></span>' : ''}${walletConnected ? 'Disconnect' : 'Connect Lace'}</button>
          </div>
        </header>
        <div class="content">${renderView()}</div>
      </main>
    </div>
    ${renderModal()}
    ${renderToasts()}
  `;
}

function renderView(): string {
  switch (state.view) {
    case 'treasury': return renderTreasury();
    case 'proposals': return renderProposals();
    case 'governance': return renderGovernance();
    case 'receipts': return renderReceipts();
    case 'security': return renderSecurity();
    default: return renderOverview();
  }
}

function renderOverview(): string {
  const safe = state.safe;
  const wallet = state.wallet;
  return `
    <section class="hero">
      <div>
        <div class="hero-kicker">Prove authorization. Reveal nothing else.</div>
        <h1>Private treasury control without the broadcast.</h1>
        <p>BLACKOUT SAFE is a Midnight-native treasury operating system. Signer identities, private proposal payloads and private policy openings stay off public state while authorization remains provable.</p>
      </div>
      <div class="hero-side">
        <button class="button primary full" data-action="open-bootstrap">${safe ? 'Deploy another Preview Safe' : 'Bootstrap Preview Safe'}</button>
        <button class="button full" data-action="open-attach">Attach existing Safe</button>
        ${!wallet ? '<button class="button ghost full" data-action="connect-wallet">Connect Lace Preview</button>' : ''}
      </div>
    </section>

    <div class="grid cards-4">
      <div class="card"><div class="card-label">Network</div><div class="card-value">Preview</div><div class="card-foot">Hard locked. No mainnet path in this build.</div></div>
      <div class="card"><div class="card-label">Lace</div><div class="card-value ${wallet ? 'green' : 'amber'}">${wallet ? 'Connected' : 'Required'}</div><div class="card-foot">${wallet ? `${h(wallet.walletName)} · DUST ${h(wallet.dust)}` : 'Real DApp Connector session only.'}</div></div>
      <div class="card"><div class="card-label">Safe</div><div class="card-value ${safe ? 'green' : 'amber'}">${safe ? 'Attached' : 'Not deployed'}</div><div class="card-foot">${safe ? `Block ${h(safe.deploymentBlockHeight)} · ${h(short(safe.contractAddress))}` : 'Deploy or attach a Preview contract.'}</div></div>
      <div class="card"><div class="card-label">Privacy mode</div><div class="card-value">${safe ? h(safe.policyMode) : '—'}</div><div class="card-foot">${safe?.policyMode === 'PRIVATE_POLICY' ? 'Threshold is not public.' : safe ? `Public quorum: ${h(safe.publicQuorum)}` : 'Configured at Safe creation.'}</div></div>
    </div>

    ${safe ? renderSafePublicPanel(safe) : `<div class="panel"><div class="empty"><div><div class="empty-title">NO PREVIEW SAFE ATTACHED</div><div class="micro">The interface will not invent balances, proposals, deployment IDs or contract state.</div></div></div></div>`}
    ${renderActivityPanel()}
  `;
}

function renderSafePublicPanel(safe: PublicSafeRecord): string {
  return `
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Public Safe manifest</div><span class="badge ${safe.deploymentVerifiedOnChain ? 'green' : 'red'}">${safe.deploymentVerifiedOnChain ? 'NETWORK VERIFIED' : 'NOT INDEPENDENTLY VERIFIED'}</span></div>
      <div class="panel-body">
        <div class="grid two">
          ${publicField('Contract', safe.contractAddress)}
          ${publicField('Deployment tx', safe.deploymentTxId)}
          ${publicField('Safe ID', safe.safeId)}
          ${publicField('Membership root', safe.membershipRoot)}
          ${publicField('Policy commitment', safe.policyCommitment)}
          ${publicField('Versions', `membership ${safe.membershipVersion} / policy ${safe.policyVersion}`)}
        </div>
        <div class="callout red" style="margin-top:14px"><strong>Fail-closed release state:</strong> a submitted deployment transaction is not marked independently verified until Preview chain/indexer verification is completed.</div>
      </div>
    </div>`;
}

function publicField(label: string, value: string): string {
  return `<div class="callout"><div class="card-label">${h(label)}</div><div class="mono break" style="margin-top:8px;color:#ddd">${h(value)}</div></div>`;
}

function renderTreasury(): string {
  const safe = state.safe;
  return `
    <div class="section-head"><div><h2>Treasury</h2><p>Deposit shielded assets into the real Safe contract and execute an approved private transfer. No display balance is fabricated; held-coin discovery remains explicit.</p></div><span class="badge ${safe ? 'green' : 'red'}">${safe ? 'SAFE ATTACHED' : 'SAFE REQUIRED'}</span></div>
    <div class="grid two">
      <div class="panel" style="margin-top:0">
        <div class="panel-head"><div class="panel-title">Shielded deposit</div><span class="badge">LIVE CALL</span></div>
        <div class="panel-body">
          <div class="field"><label>Asset color / token type · Hex32</label><input id="deposit-color" class="input" value="${ZERO32}" spellcheck="false"></div>
          <div class="field" style="margin-top:12px"><label>Value · integer base units</label><input id="deposit-value" class="input" placeholder="1000000" inputmode="numeric"></div>
          <div class="callout" style="margin-top:12px">Calls <span class="mono">deposit_shielded</span>. Lace balances and submits the actual Preview transaction.</div>
          <div class="actions"><button class="button primary" data-action="deposit" ${safe ? '' : 'disabled'}>${state.busy === 'deposit' ? '<span class="loader"></span>' : ''}Deposit to Safe</button></div>
        </div>
      </div>
      <div class="panel" style="margin-top:0">
        <div class="panel-head"><div class="panel-title">Wallet / custody boundary</div><span class="badge red">NO FAKE BALANCE</span></div>
        <div class="panel-body">
          ${state.wallet ? `
            ${publicField('Lace DUST', state.wallet.dust)}
            ${publicField('Shielded coin public key', state.wallet.shieldedCoinPublicKey ?? 'Unavailable')}
            ${publicField('Shielded encryption key', state.wallet.shieldedEncryptionPublicKey ?? 'Unavailable')}
          ` : '<div class="empty"><div><div class="empty-title">CONNECT LACE</div><div class="micro">Wallet state is read only from the real Preview connector.</div></div></div>'}
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><div class="panel-title">Execute approved shielded transfer</div><span class="badge red">ADVANCED / REAL</span></div>
      <div class="panel-body">
        <div class="callout red"><strong>Held coin opening required.</strong> The protocol intentionally does not invent a treasury coin. Until recipient/coin discovery is integrated, provide the real contract-held coin opening obtained from Preview tooling/indexer flow.</div>
        <div class="form-grid" style="margin-top:14px">
          <div class="field full"><label>Policy opening JSON</label><textarea id="exec-policy" class="textarea" placeholder='{"format":"BLACKOUT_SAFE_POLICY_OPENING_V1", ...}'></textarea></div>
          <div class="field full"><label>Private proposal bundle JSON</label><textarea id="exec-proposal" class="textarea" placeholder='{"format":"BLACKOUT_SAFE_PROPOSAL_BUNDLE_V1", ...}'></textarea></div>
          <div class="field full"><label>Held coin opening JSON</label><textarea id="exec-held-coin" class="textarea" placeholder='{"nonce":"0x...","color":"0x...","value":"1000000","mt_index":"0"}'></textarea></div>
        </div>
        <div class="actions"><button class="button primary" data-action="execute-transfer" ${safe ? '' : 'disabled'}>${state.busy === 'execute-transfer' ? '<span class="loader"></span>' : ''}Execute shielded transfer</button></div>
      </div>
    </div>`;
}

function renderProposals(): string {
  const safe = state.safe;
  return `
    <div class="section-head"><div><h2>Proposals</h2><p>Create a private transfer proposal, approve anonymously with a signer kit, then prove quorum. Signer kits and proposal bundles are never persisted by this app.</p></div><span class="badge ${safe ? 'green' : 'red'}">${safe ? 'LIVE READY' : 'SAFE REQUIRED'}</span></div>
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Create private transfer</div><span class="badge">PROPOSE_PRIVATE</span></div>
      <div class="panel-body">
        <div class="form-grid">
          <div class="field full"><label>Signer kit JSON</label><textarea id="proposal-signer" class="textarea" placeholder="Paste one signer kit exported during bootstrap"></textarea></div>
          <div class="field full"><label>Policy opening JSON</label><textarea id="proposal-policy" class="textarea" placeholder="Paste the matching policy opening"></textarea></div>
          <div class="field"><label>Asset color · Hex32</label><input id="proposal-asset" class="input" value="${ZERO32}" spellcheck="false"></div>
          <div class="field"><label>Recipient coin public key · Hex32</label><input id="proposal-recipient" class="input" placeholder="0x…" spellcheck="false"></div>
          <div class="field"><label>Amount · base units</label><input id="proposal-amount" class="input" placeholder="1000000" inputmode="numeric"></div>
          <div class="field"><label>Lifetime · seconds</label><input id="proposal-lifetime" class="input" value="3600" inputmode="numeric"></div>
          <div class="field full"><label>Memo hash · optional Hex32</label><input id="proposal-memo" class="input" placeholder="Leave blank for a random opaque memo commitment" spellcheck="false"></div>
        </div>
        <div class="actions"><button class="button primary" data-action="create-proposal" ${safe ? '' : 'disabled'}>${state.busy === 'create-proposal' ? '<span class="loader"></span>' : ''}Create private proposal</button></div>
      </div>
    </div>

    <div class="grid two">
      <div class="panel" style="margin-top:0">
        <div class="panel-head"><div class="panel-title">Anonymous approval</div><span class="badge">APPROVE_PRIVATE</span></div>
        <div class="panel-body">
          <div class="field"><label>Proposal commitment · Hex32</label><input id="approve-commitment" class="input" placeholder="0x…"></div>
          <div class="field" style="margin-top:12px"><label>Signer kit JSON</label><textarea id="approve-signer" class="textarea" placeholder="Use a different authorized signer for each approval"></textarea></div>
          <div class="field" style="margin-top:12px"><label>Proposal bundle · only required while Safe is paused</label><textarea id="approve-proposal" class="textarea" placeholder="Optional private governance bundle"></textarea></div>
          <div class="actions"><button class="button primary" data-action="approve-proposal" ${safe ? '' : 'disabled'}>${state.busy === 'approve-proposal' ? '<span class="loader"></span>' : ''}Approve</button></div>
        </div>
      </div>
      <div class="panel" style="margin-top:0">
        <div class="panel-head"><div class="panel-title">Prove quorum</div><span class="badge">PROVE_QUORUM</span></div>
        <div class="panel-body">
          <div class="field"><label>Proposal commitment · Hex32</label><input id="quorum-commitment" class="input" placeholder="0x…"></div>
          <div class="field" style="margin-top:12px"><label>Policy opening JSON</label><textarea id="quorum-policy" class="textarea"></textarea></div>
          <div class="actions"><button class="button primary" data-action="prove-quorum" ${safe ? '' : 'disabled'}>${state.busy === 'prove-quorum' ? '<span class="loader"></span>' : ''}Prove quorum</button></div>
        </div>
      </div>
    </div>`;
}

function renderGovernance(): string {
  const safe = state.safe;
  return `
    <div class="section-head"><div><h2>Governance</h2><p>Governance is proposal-driven. Pause, resume, cancellation, membership rotation and policy changes all require the same private proposal + quorum path.</p></div><span class="badge ${safe ? 'green' : 'red'}">${safe ? 'QUORUM GATED' : 'SAFE REQUIRED'}</span></div>
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Create governance proposal</div><span class="badge">PRIVATE PAYLOAD</span></div>
      <div class="panel-body">
        <div class="form-grid">
          <div class="field"><label>Action</label><select id="gov-create-action" class="select"><option>PAUSE</option><option>RESUME</option><option>CANCEL_PROPOSAL</option><option>ROTATE_MEMBERSHIP</option><option>CHANGE_POLICY</option></select></div>
          <div class="field"><label>Lifetime · seconds</label><input id="gov-create-lifetime" class="input" value="3600"></div>
          <div class="field full"><label>Signer kit JSON</label><textarea id="gov-create-signer" class="textarea"></textarea></div>
          <div class="field full"><label>Current policy opening JSON</label><textarea id="gov-create-policy" class="textarea"></textarea></div>
          <div class="field"><label>Cancel target · Hex32 when applicable</label><input id="gov-create-target" class="input" placeholder="0x…"></div>
          <div class="field"><label>New membership root · Hex32 field when applicable</label><input id="gov-create-root" class="input" placeholder="0x…"></div>
          <div class="field full"><label>Next policy opening JSON · change/rotation when applicable</label><textarea id="gov-create-next-policy" class="textarea"></textarea></div>
        </div>
        <div class="actions"><button class="button primary" data-action="create-governance" ${safe ? '' : 'disabled'}>${state.busy === 'create-governance' ? '<span class="loader"></span>' : ''}Create governance proposal</button></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><div class="panel-title">Execute approved governance</div><span class="badge red">REAL STATE CHANGE</span></div>
      <div class="panel-body">
        <div class="form-grid">
          <div class="field"><label>Action</label><select id="gov-exec-action" class="select"><option>PAUSE</option><option>RESUME</option><option>CANCEL_PROPOSAL</option><option>ROTATE_MEMBERSHIP</option><option>CHANGE_POLICY</option></select></div>
          <div class="field"><label>Cancel target · Hex32 when applicable</label><input id="gov-exec-target" class="input" placeholder="0x…"></div>
          <div class="field full"><label>Proposal bundle JSON</label><textarea id="gov-exec-proposal" class="textarea"></textarea></div>
          <div class="field full"><label>Current policy opening JSON</label><textarea id="gov-exec-policy" class="textarea"></textarea></div>
          <div class="field"><label>New membership root · when applicable</label><input id="gov-exec-root" class="input" placeholder="0x…"></div>
          <div class="field full"><label>Next policy opening JSON · when applicable</label><textarea id="gov-exec-next-policy" class="textarea"></textarea></div>
        </div>
        <div class="actions"><button class="button danger" data-action="execute-governance" ${safe ? '' : 'disabled'}>${state.busy === 'execute-governance' ? '<span class="loader"></span>' : ''}Execute governance</button></div>
      </div>
    </div>`;
}

function renderReceipts(): string {
  return `
    <div class="section-head"><div><h2>Receipts</h2><p>Run the proof-backed receipt circuits against the attached Safe. The app does not manufacture a receipt when required policy/proposal witnesses are missing.</p></div><span class="badge">BLACKOUT VERIFY BOUNDARY</span></div>
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Receipt circuit</div><span class="badge red">LIVE PROOF</span></div>
      <div class="panel-body">
        <div class="form-grid">
          <div class="field"><label>Statement</label><select id="receipt-type" class="select"><option value="receipt_quorum_authorized">QUORUM_AUTHORIZED</option><option value="receipt_executed_exactly_once">EXECUTED_EXACTLY_ONCE</option><option value="receipt_disclose_amount">DISCLOSE_AMOUNT</option><option value="receipt_disclose_recipient">DISCLOSE_RECIPIENT</option><option value="receipt_proposal_cancelled">PROPOSAL_CANCELLED</option></select></div>
          <div class="field"><label>Proposal commitment · Hex32</label><input id="receipt-commitment" class="input" placeholder="0x…"></div>
          <div class="field full"><label>Policy opening JSON · required for quorum statement</label><textarea id="receipt-policy" class="textarea"></textarea></div>
          <div class="field full"><label>Proposal bundle JSON · required for executed/disclosure statements</label><textarea id="receipt-proposal" class="textarea"></textarea></div>
        </div>
        <div class="actions"><button class="button primary" data-action="run-receipt" ${state.safe ? '' : 'disabled'}>${state.busy === 'run-receipt' ? '<span class="loader"></span>' : ''}Generate proof transaction</button></div>
      </div>
    </div>
    <div class="callout red" style="margin-top:14px"><strong>Blackout Verify integration remains a separate final step.</strong> These circuits create the on-chain proof transaction. Packaging/verifying the resulting statement through the Verify product still needs the Verify-side adapter.</div>`;
}

function renderSecurity(): string {
  const checks: Array<[boolean, string, string]> = [
    [true, 'Lace-only connector selection', 'DONE'],
    [true, 'Preview network enforcement', 'DONE'],
    [true, 'Wallet account / network mutation detection', 'DONE'],
    [true, 'HTTPS/WSS endpoint hardening', 'DONE'],
    [true, 'Session-scoped private state and signing keys', 'DONE'],
    [true, 'Same-origin ZK artifact pinning', 'DONE'],
    [true, 'Canonical TRANSFER / GOVERNANCE payload enforcement', 'DONE'],
    [true, 'Duplicate approval + replay nullifiers', 'DONE'],
    [true, 'No master/admin withdrawal key', 'DONE'],
    [true, '92 core protocol/security/privacy tests on hardened base', 'DONE'],
    [true, '15-circuit full ZK generation on hardened base', 'DONE'],
    [Boolean(state.safe), 'Preview Safe deployed or attached in this browser', state.safe ? 'LOCAL MANIFEST' : 'PENDING'],
    [Boolean(state.safe?.deploymentVerifiedOnChain), 'Independent Preview deployment verification', state.safe?.deploymentVerifiedOnChain ? 'VERIFIED' : 'PENDING'],
    [false, 'Multi-wallet 3+ signer Preview run', 'PENDING'],
    [false, 'Recipient discovery / ciphertext delivery', 'PENDING'],
    [false, 'Blackout Verify end-to-end receipt validation', 'PENDING'],
  ];
  return `
    <div class="section-head"><div><h2>Security</h2><p>Go/no-go state. Checked items are implemented or have evidence; runtime items remain unchecked until real Preview evidence exists.</p></div><span class="badge green">FAIL CLOSED</span></div>
    <div class="checklist">
      ${checks.map(([done, label, status]) => `<div class="check ${done ? 'done' : 'pending'}"><span class="box">${done ? '✓' : '·'}</span><span>${h(label)}</span><span class="state">${h(status)}</span></div>`).join('')}
    </div>
    <div class="callout red" style="margin-top:14px"><strong>Mainnet is not part of this app.</strong> Network selection is hard-coded to Midnight Preview and the runtime release gate never auto-authorizes production.</div>`;
}

function renderActivityPanel(): string {
  return `<div class="panel"><div class="panel-head"><div class="panel-title">Public transaction activity</div><button class="button small ghost" data-action="clear-activity">Clear local log</button></div><div class="panel-body" style="padding:0">${state.activity.length ? `<div class="log-list">${state.activity.map((item) => `<div class="log-item"><span>${h(new Date(item.at).toLocaleString())}</span><strong>${h(item.type)}</strong><span class="break">${h(item.txId)} · ${h(item.detail)}</span></div>`).join('')}</div>` : '<div class="empty"><div><div class="empty-title">NO PUBLIC TX ACTIVITY YET</div><div class="micro">Only transaction IDs and public metadata are stored here.</div></div></div>'}</div></div>`;
}

function renderModal(): string {
  if (state.modal === 'bootstrap') return renderBootstrapModal();
  if (state.modal === 'attach') return renderAttachModal();
  return '';
}

function renderBootstrapModal(): string {
  const bootstrap = state.bootstrap;
  return `<div class="modal-backdrop"><div class="modal">
    <div class="modal-head"><h3>Bootstrap BLACKOUT SAFE / Preview</h3><button class="close" data-action="close-modal">×</button></div>
    <div class="modal-body">
      <div class="callout red"><strong>Testnet bootstrap:</strong> signer secrets are generated locally with Web Crypto and kept only in memory. Export every signer kit before deploying. Refreshing the page destroys the in-memory copies.</div>
      <div class="form-grid" style="margin-top:14px">
        <div class="field"><label>Authorized members</label><input id="boot-members" class="input" value="5" inputmode="numeric"></div>
        <div class="field"><label>Quorum threshold</label><input id="boot-threshold" class="input" value="3" inputmode="numeric"></div>
        <div class="field"><label>Policy mode</label><select id="boot-mode" class="select"><option value="PRIVATE_POLICY">PRIVATE_POLICY</option><option value="STANDARD">STANDARD</option></select></div>
        <div class="field"><label>Max transfer · 0 = unlimited</label><input id="boot-max-transfer" class="input" value="0"></div>
        <div class="field"><label>Max proposal lifetime · seconds</label><input id="boot-lifetime" class="input" value="86400"></div>
        <div class="field"><label>Min execution delay · seconds</label><input id="boot-delay" class="input" value="0"></div>
      </div>
      <div class="actions"><button class="button" data-action="generate-bootstrap">Generate exact Compact setup</button></div>
      ${bootstrap ? `
        <div class="panel">
          <div class="panel-head"><div class="panel-title">Generated in memory</div><span class="badge green">EXACT COMPACT HASHING</span></div>
          <div class="panel-body">
            ${publicField('Safe ID', bytesToHex32(bootstrap.membership.safeId))}
            <div style="height:8px"></div>${publicField('Membership root', bootstrap.membership.rootHex)}
            <div style="height:8px"></div>${publicField('Policy commitment', bytesToHex32(bootstrap.policyCommitment))}
            <div style="margin-top:14px" class="card-label">Export private material before deployment</div>
            ${bootstrap.membership.kits.map((kit, index) => `<div class="kit-row"><div class="meta"><strong>Signer ${index + 1}</strong><span>${h(short(kit.memberCommitment, 18, 12))}</span></div><button class="button small" data-action="download-signer" data-index="${index}">Download kit</button></div>`).join('')}
            <div class="kit-row"><div class="meta"><strong>Policy opening</strong><span>Required for proposal policy proofs and quorum</span></div><button class="button small" data-action="download-policy">Download opening</button></div>
            <div class="callout" style="margin-top:12px">The app does not write signer secrets, proposal payloads or policy openings to localStorage.</div>
            <div class="actions"><button class="button primary" data-action="deploy-bootstrap" ${state.wallet ? '' : 'disabled'}>${state.busy === 'deploy' ? '<span class="loader"></span>' : ''}Deploy real Preview Safe</button>${!state.wallet ? '<button class="button" data-action="connect-wallet">Connect Lace first</button>' : ''}</div>
          </div>
        </div>` : ''}
    </div>
  </div></div>`;
}

function renderAttachModal(): string {
  return `<div class="modal-backdrop"><div class="modal">
    <div class="modal-head"><h3>Attach existing Preview Safe</h3><button class="close" data-action="close-modal">×</button></div>
    <div class="modal-body">
      <div class="callout">Only public deployment metadata is stored locally. Attaching does not claim the contract has been independently verified.</div>
      <div class="form-grid" style="margin-top:14px">
        <div class="field full"><label>Contract address</label><input id="attach-contract" class="input" placeholder="64-hex / 0x / 0200 form"></div>
        <div class="field full"><label>Deployment transaction ID</label><input id="attach-tx" class="input" placeholder="64-hex transaction ID"></div>
        <div class="field"><label>Deployment block height</label><input id="attach-block" class="input" value="0"></div>
        <div class="field"><label>Policy mode</label><select id="attach-mode" class="select"><option>PRIVATE_POLICY</option><option>STANDARD</option></select></div>
        <div class="field full"><label>Safe ID · Hex32</label><input id="attach-safe-id" class="input" placeholder="0x…"></div>
        <div class="field full"><label>Membership root field · Hex32</label><input id="attach-root" class="input" placeholder="0x…"></div>
        <div class="field full"><label>Policy commitment · Hex32</label><input id="attach-policy" class="input" placeholder="0x…"></div>
        <div class="field"><label>Membership version</label><input id="attach-membership-version" class="input" value="1"></div>
        <div class="field"><label>Policy version</label><input id="attach-policy-version" class="input" value="1"></div>
        <div class="field"><label>Public quorum · STANDARD only</label><input id="attach-quorum" class="input" placeholder="3"></div>
        <div class="field"><label><input id="attach-verified" type="checkbox"> Independently verified on Preview</label><div class="help">Check only if you personally verified deployment finalization/on-chain existence.</div></div>
      </div>
      <div class="actions"><button class="button primary" data-action="attach-safe">Attach Safe</button></div>
    </div>
  </div></div>`;
}

function renderToasts(): string {
  return `<div class="toast-stack">${state.toasts.map((item) => `<div class="toast ${item.type}">${h(item.message)}</div>`).join('')}</div>`;
}

function render(): void {
  app.innerHTML = renderShell();
}

async function handleAction(action: string, button: HTMLElement): Promise<void> {
  switch (action) {
    case 'connect-wallet': {
      const result = await runBusy('wallet', connectWallet);
      if (result) { state.wallet = result; toast('Lace Preview connected and DUST check passed.', 'success'); }
      break;
    }
    case 'disconnect-wallet':
      disconnectWallet(); state.wallet = null; toast('Lace session cleared.'); break;
    case 'open-bootstrap': state.modal = 'bootstrap'; state.bootstrap = null; break;
    case 'open-attach': state.modal = 'attach'; break;
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
        toast('Signer tree and policy commitment generated with compiler-exact hashing.', 'success');
      } catch (error) { toast(errorMessage(error), 'error'); }
      break;
    }
    case 'download-signer': {
      if (!state.bootstrap) break;
      const index = Number(button.dataset.index ?? '-1');
      const kit = state.bootstrap.membership.kits[index];
      if (!kit) { toast('BLACKOUT_SAFE_SIGNER_KIT_NOT_FOUND', 'error'); break; }
      downloadJson(`blackout-safe-signer-${index + 1}.json`, kit);
      break;
    }
    case 'download-policy':
      if (state.bootstrap) downloadJson('blackout-safe-policy-opening.json', state.bootstrap.policyOpening);
      break;
    case 'deploy-bootstrap': {
      if (!state.bootstrap) { toast('Generate bootstrap material first.', 'error'); break; }
      const deployed = await runBusy('deploy', () => deployBootstrap(state.bootstrap!));
      if (deployed) {
        state.safe = deployed; savePublicState(); addActivity('DEPLOY', { txId: deployed.deploymentTxId }, `block ${deployed.deploymentBlockHeight}`);
        downloadJson('blackout-safe-public-manifest.json', deployed);
        state.modal = null;
        toast('Preview deployment submitted. Public manifest downloaded. Independent verification still pending.', 'success');
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
          deploymentVerifiedOnChain: checked('attach-verified'),
        });
        savePublicState(); state.modal = null; toast('Preview Safe attached.', 'success');
      } catch (error) { toast(errorMessage(error), 'error'); }
      break;
    }
    case 'deposit': {
      const result = await runBusy('deposit', () => depositShielded(requireSafe(), inputValue('deposit-color') as Hex32String, asBigInt(inputValue('deposit-value'), 'BLACKOUT_SAFE_DEPOSIT_VALUE', false)));
      if (result) { addActivity('DEPOSIT', result, `block ${result.blockHeight}`); toast(`Deposit submitted: ${short(result.txId)}`, 'success'); }
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
        toast('Private proposal submitted. Proposal bundle downloaded; keep it private.', 'success');
      }
      break;
    }
    case 'approve-proposal': {
      const optionalBundle = inputValue('approve-proposal');
      const result = await runBusy('approve-proposal', () => approveProposal({
        safe: requireSafe(),
        signerKit: parseJsonInput<SerializedSafeSignerKit>('approve-signer', 'BLACKOUT_SAFE_SIGNER_KIT'),
        proposalCommitment: inputValue('approve-commitment') as Hex32String,
        proposalBundle: optionalBundle ? JSON.parse(optionalBundle) as SerializedProposalBundle : undefined,
      }));
      if (result) { addActivity('APPROVE', result, inputValue('approve-commitment')); toast('Anonymous approval submitted.', 'success'); }
      break;
    }
    case 'prove-quorum': {
      const commitment = inputValue('quorum-commitment') as Hex32String;
      const result = await runBusy('prove-quorum', () => proveQuorum({ safe: requireSafe(), policyOpening: parseJsonInput('quorum-policy', 'BLACKOUT_SAFE_POLICY_OPENING'), proposalCommitment: commitment }));
      if (result) { addActivity('QUORUM', result, commitment); toast('Quorum proof submitted.', 'success'); }
      break;
    }
    case 'execute-transfer': {
      const result = await runBusy('execute-transfer', () => executeTransfer({
        safe: requireSafe(),
        policyOpening: parseJsonInput('exec-policy', 'BLACKOUT_SAFE_POLICY_OPENING'),
        proposalBundle: parseJsonInput('exec-proposal', 'BLACKOUT_SAFE_PROPOSAL_BUNDLE'),
        heldCoin: parseJsonInput('exec-held-coin', 'BLACKOUT_SAFE_HELD_COIN'),
      }));
      if (result) { addActivity('EXECUTE_TRANSFER', result, `block ${result.blockHeight}`); toast('Shielded transfer execution submitted.', 'success'); }
      break;
    }
    case 'create-governance': {
      const actionName = inputValue('gov-create-action') as GovernanceAction;
      const nextRaw = inputValue('gov-create-next-policy');
      const result = await runBusy('create-governance', () => createGovernanceProposal({
        safe: requireSafe(),
        signerKit: parseJsonInput('gov-create-signer', 'BLACKOUT_SAFE_SIGNER_KIT'),
        policyOpening: parseJsonInput('gov-create-policy', 'BLACKOUT_SAFE_POLICY_OPENING'),
        action: actionName,
        lifetimeSeconds: asBigInt(inputValue('gov-create-lifetime'), 'BLACKOUT_SAFE_LIFETIME', false),
        targetProposal: inputValue('gov-create-target') ? inputValue('gov-create-target') as Hex32String : undefined,
        newMembershipRoot: inputValue('gov-create-root') ? inputValue('gov-create-root') as Hex32String : undefined,
        nextPolicy: nextRaw ? JSON.parse(nextRaw) as SerializedPolicyOpening : undefined,
      }));
      if (result) {
        addActivity('GOV_PROPOSE', result.tx, `${actionName} · ${result.proposalBundle.proposalCommitment}`);
        downloadJson(`blackout-safe-governance-${actionName.toLowerCase()}.json`, result.proposalBundle);
        toast('Governance proposal submitted and private bundle downloaded.', 'success');
      }
      break;
    }
    case 'execute-governance': {
      const actionName = inputValue('gov-exec-action') as GovernanceAction;
      const nextRaw = inputValue('gov-exec-next-policy');
      const result = await runBusy('execute-governance', () => executeGovernance({
        safe: requireSafe(),
        action: actionName,
        policyOpening: parseJsonInput('gov-exec-policy', 'BLACKOUT_SAFE_POLICY_OPENING'),
        proposalBundle: parseJsonInput('gov-exec-proposal', 'BLACKOUT_SAFE_PROPOSAL_BUNDLE'),
        targetProposal: inputValue('gov-exec-target') ? inputValue('gov-exec-target') as Hex32String : undefined,
        newMembershipRoot: inputValue('gov-exec-root') ? inputValue('gov-exec-root') as Hex32String : undefined,
        nextPolicy: nextRaw ? JSON.parse(nextRaw) as SerializedPolicyOpening : undefined,
      }));
      if (result) { addActivity('GOV_EXECUTE', result, actionName); toast(`${actionName} governance execution submitted.`, 'success'); }
      break;
    }
    case 'run-receipt': {
      const policyRaw = inputValue('receipt-policy');
      const proposalRaw = inputValue('receipt-proposal');
      const result = await runBusy('run-receipt', () => runReceiptCircuit({
        safe: requireSafe(),
        circuitId: inputValue('receipt-type') as any,
        proposalCommitment: inputValue('receipt-commitment') as Hex32String,
        policyOpening: policyRaw ? JSON.parse(policyRaw) as SerializedPolicyOpening : undefined,
        proposalBundle: proposalRaw ? JSON.parse(proposalRaw) as SerializedProposalBundle : undefined,
      }));
      if (result) { addActivity('RECEIPT', result, inputValue('receipt-type')); toast('Receipt proof transaction submitted.', 'success'); }
      break;
    }
    case 'clear-activity': state.activity = []; savePublicState(); break;
    case 'refresh-wallet': {
      const result = await runBusy('wallet', refreshWallet);
      if (result) state.wallet = result;
      break;
    }
  }
  render();
}

document.addEventListener('click', (event) => {
  const target = event.target as Element | null;
  const viewButton = target?.closest<HTMLElement>('[data-view]');
  if (viewButton?.dataset.view) {
    state.view = viewButton.dataset.view as View;
    location.hash = `#/${state.view}`;
    state.modal = null;
    render();
    return;
  }
  const actionButton = target?.closest<HTMLElement>('[data-action]');
  if (actionButton?.dataset.action) void handleAction(actionButton.dataset.action, actionButton);
});

window.addEventListener('hashchange', () => {
  const next = location.hash.replace('#/', '') as View;
  if (['overview', 'treasury', 'proposals', 'governance', 'receipts', 'security'].includes(next)) state.view = next;
  render();
});

render();
