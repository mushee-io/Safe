import { domainHash } from './crypto.ts';
import type { Hex32, ShieldedTransferRequest, ShieldedTransferResult } from './model.ts';

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
  getSpendableBalance(tokenType: Hex32): Promise<bigint>;
  executeShieldedTransfer(request: ShieldedTransferRequest): Promise<ShieldedTransferResult>;
}

/** Explicit fail-closed adapter for environments where treasury custody is not wired. */
export class UnavailableShieldedTreasury implements ShieldedTreasuryAdapter {
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
        'blackout:safe:test-shielded-transfer:v1',
        request.safeId,
        request.proposalCommitment,
        request.tokenType,
        request.recipientCoinPublicKey,
        request.amount,
        this.sequence,
      ),
      kind: 'SHIELDED',
    };
  }
}
