/**
 * Settled-Cash / GFV-Proof Ledger
 *
 * Enforces the cash-account settlement rule that Gordon's trading constitution
 * only states as doctrine: a buy may only be funded by SETTLED cash. Proceeds
 * from a sale settle on a later date (T+1 for equities); spending them before
 * they settle is a Good-Faith Violation (GFV) / free-riding. This ledger makes
 * a GFV structurally impossible — an unsettled-proceeds buy is rejected.
 *
 * Design invariants:
 *   - Dates are INJECTED. There is no hardcoded holiday / trading-day calendar;
 *     the caller supplies each proceed's settlement date and the `asOf` clock.
 *   - This is an ADDITIVE restriction only. It can reject a buy that would have
 *     been allowed by a looser gate; it never loosens any other guard.
 *   - `canBuy` is pure (no mutation). `recordBuy` mutates and first promotes
 *     any pending credits that have matured as of the trade date.
 *
 * Applies to the cash-account brokers Gordon trades (Alpaca / IBKR).
 */

export interface PendingCredit {
  /** Cash amount that will settle. Always positive. */
  amount: number;
  /** Date on which the amount becomes settled cash. */
  settlesOn: Date;
  /** Optional provenance tag (e.g. the position or order id that sold). */
  source?: string;
}

export interface CanBuyResult {
  allowed: boolean;
  /** Settled cash available as of the trade date (settled + matured pending). */
  settledAvailable: number;
  /** How much the buy exceeds settled cash by (0 when allowed). */
  shortfall: number;
  reason?: string;
}

export interface RecordBuyResult extends CanBuyResult {
  /** True when the buy was accepted and settled cash debited. */
  accepted: boolean;
  /** Pending credits promoted to settled by the pre-buy maturity sweep. */
  matured: number;
}

function assertPositive(amount: number, label: string): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new RangeError(`${label} must be a positive finite number, got ${amount}`);
  }
}

export class SettledCashLedger {
  private _settled: number;
  private _pending: PendingCredit[] = [];

  constructor(initialSettledCash = 0) {
    if (!Number.isFinite(initialSettledCash) || initialSettledCash < 0) {
      throw new RangeError(
        `initialSettledCash must be a non-negative finite number, got ${initialSettledCash}`,
      );
    }
    this._settled = initialSettledCash;
  }

  /** Cash that has fully settled and is spendable now. */
  get settledCash(): number {
    return this._settled;
  }

  /** Snapshot of the unsettled pending bucket (T+N proceeds). */
  get pending(): readonly PendingCredit[] {
    return this._pending;
  }

  /** Total unsettled proceeds still in the pending bucket. */
  get pendingTotal(): number {
    return this._pending.reduce((sum, c) => sum + c.amount, 0);
  }

  /** Deposit external cash. Deposits settle immediately. */
  deposit(amount: number): void {
    assertPositive(amount, "deposit amount");
    this._settled += amount;
  }

  /**
   * Book sale proceeds into the unsettled pending bucket. They become spendable
   * only once `settlesOn` is reached (see `applyMatured` / `settledAvailable`).
   */
  addProceeds(amount: number, settlesOn: Date, source?: string): void {
    assertPositive(amount, "proceeds amount");
    this._pending.push({ amount, settlesOn, source });
  }

  /**
   * Promote every pending credit whose settlement date is on or before `asOf`
   * into settled cash. Returns the total amount promoted. Idempotent for a
   * given clock: calling it twice with the same `asOf` promotes nothing new.
   */
  applyMatured(asOf: Date): number {
    const cutoff = asOf.getTime();
    let promoted = 0;
    const stillPending: PendingCredit[] = [];
    for (const credit of this._pending) {
      if (credit.settlesOn.getTime() <= cutoff) {
        promoted += credit.amount;
      } else {
        stillPending.push(credit);
      }
    }
    if (promoted > 0) {
      this._settled += promoted;
      this._pending = stillPending;
    }
    return promoted;
  }

  /**
   * Settled cash available as of `asOf` WITHOUT mutating: current settled cash
   * plus any pending credit that has matured by that date. Pure.
   */
  settledAvailable(asOf: Date): number {
    const cutoff = asOf.getTime();
    let matured = 0;
    for (const credit of this._pending) {
      if (credit.settlesOn.getTime() <= cutoff) matured += credit.amount;
    }
    return this._settled + matured;
  }

  /**
   * Would a buy of `notional` be funded entirely by settled cash as of `asOf`?
   * Pure — does not mutate the ledger. A buy that would draw on unsettled
   * proceeds is a GFV and is not allowed.
   */
  canBuy(notional: number, asOf: Date): CanBuyResult {
    assertPositive(notional, "buy notional");
    const settledAvailable = this.settledAvailable(asOf);
    if (settledAvailable >= notional) {
      return { allowed: true, settledAvailable, shortfall: 0 };
    }
    return {
      allowed: false,
      settledAvailable,
      shortfall: notional - settledAvailable,
      reason: "GFV: buy would draw on unsettled proceeds; settled cash does not cover the notional",
    };
  }

  /**
   * Debit settled cash for a buy of `notional`, first sweeping matured pending
   * credits into settled cash as of `asOf`. Rejects (without mutating balances)
   * when settled cash does not cover the notional — a Good-Faith Violation.
   */
  recordBuy(notional: number, asOf: Date): RecordBuyResult {
    assertPositive(notional, "buy notional");
    const matured = this.applyMatured(asOf);
    const check = this.canBuy(notional, asOf);
    if (!check.allowed) {
      return { ...check, accepted: false, matured };
    }
    this._settled -= notional;
    return { ...check, accepted: true, matured };
  }
}
