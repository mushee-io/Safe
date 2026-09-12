import { domainHash } from './crypto.ts';
import type {
  Hex32,
  ShieldedTransferRequest,
  ShieldedTransferResult,
  ShieldedTreasuryCapabilities,
} from './model.ts';

export class TreasuryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'TreasuryError';
  }
}

/**
 * Port implemented by a real Midnight contract-custody integration later.
 * LIVE code must never silently substitute the in-memory reference adapter.
 */
export interface ShieldedTreasuryAdapter {
  /** Required for LIVE adapters. Omitted only by the legacy reference-test shape. */
  getCapabilities?: () => Promise<ShieldedTreasuryCapabilities>;
  getSpendableBalance(tokenType: Hex32): Promise<bigint>;
  executeShieldedTransfer(request: ShieldedTransferRequest): Promise<ShieldedTransferResult>;
}

/**
 * Resolve capabilities without ever upgrading an unknown adapter to LIVE.
 * The compatibility branch exists only for historical reference tests and is
 * deliberately classified as REFERENCE with no network transaction id.
 */
export async function getTreasuryCapabilities(adapter: ShieldedTreasuryAdapter): Promise<ShieldedTreasuryCapabilities> {
  if (adapter.getCapabilities) return adapter.getCapabilities();
  return {
    mode: 'REFERENCE',
    supportsShieldedCustody: true,
    supportsShieldedSpend: true,
    recipientDiscovery: 'EXECUTOR_ASSISTED',
    returnsNetworkTransactionId: false,
  };
}

/** Explicit fail-closed adapter for environments where treasury custody is not wired. */
export class UnavailableShieldedTreasury implements ShieldedTreasuryAdapter {
  async getCapabilities(): Promise<ShieldedTreasuryCapabilities> {
    return {
      mode: 'UNAVAILABLE',
      supportsShieldedCustody: false,
      supportsShieldedSpend: false,
      recipientDiscovery: 'NONE',
      returnsNetworkTransactionId: false,
    };
  }

  async getSpendableBalance(): Promise<bigint> {
    throw new TreasuryError('TREASURY_UNAVAILABLE', 'No real Midnight shielded treasury adapter is configured.');
  }

  async executeShieldedTransfer(): Promise<ShieldedTransferResult> {
    throw new TreasuryError('TREASURY_UNAVAILABLE', 'No real Midnight shielded treasury adapter is configured.');
  }
}

/**
 * Deterministic TEST-ONLY balance harness. It is never a LIVE fallback.
 * Its purpose is to exercise atomic execution/replay/insufficient-funds logic.
 */
export class ReferenceShieldedTreasury implements ShieldedTreasuryAdapter {
  private readonly balances = new Map<Hex32, bigint>();
  private sequence = 0n;

  constructor(initial: Array<{ tokenType: Hex32; balance: bigint }> = []) {
    for (const entry of initial) {
      if (entry.balance < 0n) throw new TreasuryError('INVALID_BALANCE', 'reference balance cannot be negative');
      this.balances.set(entry.tokenType, entry.balance);
    }
  }

  async getCapabilities(): Promise<ShieldedTreasuryCapabilities> {
    return {
      mode: 'REFERENCE',
      supportsShieldedCustody: true,
      supportsShieldedSpend: true,
      // The real contract-to-wallet path requires executor/application support
      // for recipient discovery/ciphertext delivery. The reference adapter does
      // not pretend this is wallet-native.
      recipientDiscovery: 'EXECUTOR_ASSISTED',
      returnsNetworkTransactionId: false,
    };
  }

  async getSpendableBalance(tokenType: Hex32): Promise<bigint> {
    return this.balances.get(tokenType) ?? 0n;
  }

  async executeShieldedTransfer(request: ShieldedTransferRequest): Promise<ShieldedTransferResult> {
    const current = await this.getSpendableBalance(request.tokenType);
    if (request.amount <= 0n) throw new TreasuryError('INVALID_AMOUNT', 'shielded transfer amount must be positive');
    if (current < request.amount) throw new TreasuryError('INSUFFICIENT_FUNDS', 'shielded treasury balance is insufficient');
    this.balances.set(request.tokenType, current - request.amount);
    this.sequence += 1n;
    return {
      transferId: await domainHash(
        'blackout:safe:test-shielded-transfer:v2',
        request.safeId,
        request.proposalCommitment,
        request.tokenType,
        request.recipientCoinPublicKey,
        request.amount,
        this.sequence,
      ),
      kind: 'SHIELDED',
      mode: 'REFERENCE',
      networkTransactionId: null,
      recipientDiscovery: 'EXECUTOR_ASSISTED',
    };
  }
}
