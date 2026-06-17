/**
 * Barbell LIVE runner — drives the barbell decision (`barbellStrategy.ts`) onto the MT5
 * bridge via TARGET-PORTFOLIO RECONCILIATION.
 *
 * The barbell book is multi-leg + cross-instrument (each pair is long one symbol / short
 * another; the sleeve is a single leveraged leg), so the single-position-per-symbol
 * `CompetitionLiveTrader` doesn't fit. Instead we:
 *   1. aggregate the whole barbell decision into ONE signed target notional per symbol
 *      (sum of every pair-leg + the sleeve touching that symbol),
 *   2. read current positions as signed net volume per symbol,
 *   3. emit the market-order DELTA to move each symbol from current → target.
 * This is the standard "target book → reconcile" pattern; it naturally opens, scales, and
 * closes legs as the barbell's targets change, and it's idempotent (re-running with the
 * same targets emits no orders).
 *
 * DOUBLE SAFETY GUARD is preserved: orders only fire when `GORDON_LIVE_TRADING==="1"`
 * (this process) AND the sidecar's `MT5_BRIDGE_ALLOW_TRADING=1`. Unset either → DRY (the
 * deltas are computed + logged, nothing is sent).
 *
 * The aggregation + reconciliation are PURE functions (tested without a broker); the
 * runner class only wires client I/O + the guard around them.
 */

import type {
  Mt5Account,
  Mt5Position,
  Mt5Quote,
  Mt5Bar,
  Mt5OrderRequest,
  Mt5OrderResult,
} from "../../broker/mt5/bridgeClient.ts";
import type { ContractSpec } from "./liveTrader.ts";
import { barbellDecision, type BarbellConfig, type BarbellDecision, BARBELL_CONFIG } from "./barbellStrategy.ts";
import { marginCircuitBreaker } from "./survivalStop.ts";

/** Mockable subset of the bridge the runner needs (same shape as liveTrader's Mt5Like). */
export interface Mt5Like {
  account(): Promise<Mt5Account>;
  positions(): Promise<Mt5Position[]>;
  quote(symbol: string): Promise<Mt5Quote>;
  bars(params: { symbol: string; timeframe?: string; count?: number }): Promise<Mt5Bar[]>;
  placeOrder(req: Mt5OrderRequest): Promise<Mt5OrderResult>;
}

// ── Pure core: aggregate the barbell decision into per-symbol signed target notional ──

/**
 * Collapse a barbell decision into ONE signed target notional per symbol (USD; + = net
 * long, − = net short). Each active pair contributes its leg notionals with the leg's
 * sign; the sleeve adds its directional notional. Symbols that net to ~0 (the two legs of
 * different pairs cancelling) correctly produce a small/zero target — that's the
 * dollar-neutral book expressed as net per-symbol exposure.
 */
export function aggregateTargetNotionals(decision: BarbellDecision): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (sym: string, signed: number) => {
    out[sym] = (out[sym] ?? 0) + signed;
  };
  for (const p of decision.core) {
    if (p.sideA === "buy") add(p.symbolA, p.notionalA);
    else if (p.sideA === "sell") add(p.symbolA, -p.notionalA);
    if (p.sideB === "buy") add(p.symbolB, p.notionalB);
    else if (p.sideB === "sell") add(p.symbolB, -p.notionalB);
  }
  if (decision.sleeve) {
    add(decision.sleeve.symbol, decision.sleeve.side === "buy" ? decision.sleeve.notional : -decision.sleeve.notional);
  }
  return out;
}

export interface ReconcileOrder {
  symbol: string;
  side: "buy" | "sell";
  lots: number;
  reason: string;
}

/** Round a signed unit size to a valid signed lot count (snap to step, floor to ≥ min). */
function unitsToSignedLots(units: number, spec: ContractSpec): number {
  const contractSize = spec.contractSize && spec.contractSize > 0 ? spec.contractSize : 1;
  const sign = units < 0 ? -1 : 1;
  const rawLots = Math.abs(units) / contractSize;
  const step = spec.volume_step > 0 ? spec.volume_step : spec.volume_min;
  const stepped = Math.floor(rawLots / step) * step;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) || 0);
  const rounded = parseFloat(stepped.toFixed(decimals));
  return rounded < spec.volume_min ? 0 : sign * rounded;
}

/**
 * Compute the market-order deltas that move each symbol from its current signed lots to
 * its target. Pure: target notionals + current positions + quotes + specs in, orders out.
 * A symbol whose |target − current| rounds below volume_min emits no order (idempotent).
 */
export function reconcile(
  targetNotionalBySymbol: Record<string, number>,
  positions: Mt5Position[],
  quoteBySymbol: Record<string, Mt5Quote>,
  contracts: Record<string, ContractSpec>,
  symbols: string[],
): ReconcileOrder[] {
  // Current signed lots per symbol (long +, short −), netting tickets.
  const curLots: Record<string, number> = {};
  for (const p of positions) {
    const signed = p.sideLabel === "long" ? p.volume : -p.volume;
    curLots[p.symbol] = (curLots[p.symbol] ?? 0) + signed;
  }

  const orders: ReconcileOrder[] = [];
  for (const symbol of symbols) {
    const spec = contracts[symbol];
    const q = quoteBySymbol[symbol];
    if (!spec || !q) continue;
    const mid = q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : q.last;
    if (!(mid > 0)) continue;

    const targetNotional = targetNotionalBySymbol[symbol] ?? 0; // 0 = flatten this symbol
    const targetUnits = targetNotional / mid;
    const targetLots = unitsToSignedLots(targetUnits, spec);
    const current = curLots[symbol] ?? 0;
    const deltaLots = parseFloat((targetLots - current).toFixed(8));

    if (Math.abs(deltaLots) < spec.volume_min) continue; // already at target (idempotent)
    orders.push({
      symbol,
      side: deltaLots > 0 ? "buy" : "sell",
      lots: Math.abs(deltaLots),
      reason: `reconcile ${symbol}: current ${current} → target ${targetLots} lots (Δ ${deltaLots})`,
    });
  }
  return orders;
}

// ── The runner ───────────────────────────────────────────────────────────────

export interface BarbellRunnerConfig {
  symbols: string[];
  contracts: Record<string, ContractSpec>;
  startingEquity: number;
  /** Bars to the contest deadline (for the liquidation horizon). */
  barsToDeadline: () => number;
  /** Contest phase gate (pre_cut → no sleeve; post_cut → sleeve eligible). */
  phase: () => "pre_cut" | "post_cut";
  barsLookback: number;
  timeframe: string;
  barbellConfig?: BarbellConfig;
  /**
   * Margin-level (percent) at which the survival circuit breaker flattens the entire book
   * — must sit ABOVE the 30% stop-out (= elimination). Default 50 (see `survivalStop.ts`).
   * Per-leg stops are deliberately NOT used: they would un-hedge the dollar-neutral core.
   */
  breakerLevelPct?: number;
}

export interface BarbellCycleReport {
  equity: number;
  ourReturnPct: number;
  liveArmed: boolean;
  decisionReason: string;
  /** Account margin level (percent) this cycle. */
  marginLevelPct: number;
  /** True ⇒ the survival breaker fired and the book was flattened (targets forced to 0). */
  breakerTripped: boolean;
  orders: Array<ReconcileOrder & { action: "placed" | "dry" | "refused" | "error"; detail?: string }>;
  ordersPlaced: number;
}

export class BarbellLiveRunner {
  private readonly client: Mt5Like;
  private readonly cfg: BarbellRunnerConfig;
  private readonly log: (m: string) => void;
  private running = false;

  constructor(client: Mt5Like, cfg: BarbellRunnerConfig, log: (m: string) => void = (m) => console.log(m)) {
    this.client = client;
    this.cfg = cfg;
    this.log = log;
  }

  private liveArmed(): boolean {
    return process.env.GORDON_LIVE_TRADING === "1";
  }

  async runCycle(): Promise<BarbellCycleReport> {
    const account = await this.client.account();
    const equity = account.equity;
    const ourReturnPct = this.cfg.startingEquity > 0 ? equity / this.cfg.startingEquity - 1 : 0;

    const barsBySymbol: Record<string, Mt5Bar[]> = {};
    const quoteBySymbol: Record<string, Mt5Quote> = {};
    for (const symbol of this.cfg.symbols) {
      barsBySymbol[symbol] = await this.client.bars({ symbol, timeframe: this.cfg.timeframe, count: this.cfg.barsLookback });
      quoteBySymbol[symbol] = await this.client.quote(symbol);
    }

    // SURVIVAL circuit breaker runs FIRST. If the account margin level nears the 30% stop-out
    // (= elimination), flatten the WHOLE book (targets → 0) and skip the barbell decision
    // entirely — per-leg stops would un-hedge the core, and `barbellDecision` itself refuses
    // to carve a sleeve below the ring-fence red-line (it throws), so in a survival emergency
    // we must NOT depend on it. Breaker level sits above the stop-out for buffer.
    const breaker = marginCircuitBreaker({
      marginLevelPct: account.margin_level,
      usedMargin: account.margin,
      breakerLevelPct: this.cfg.breakerLevelPct,
    });

    let targets: Record<string, number>;
    let decisionReason: string;
    if (breaker.tripped) {
      this.log(`[barbell] SURVIVAL CIRCUIT BREAKER — ${breaker.reason}`);
      targets = {}; // flatten everything
      decisionReason = breaker.reason;
    } else {
      const decision = barbellDecision({
        barsBySymbol,
        equity,
        startingEquity: this.cfg.startingEquity,
        ourReturnPct,
        barsToDeadline: this.cfg.barsToDeadline(),
        phase: this.cfg.phase(),
        config: this.cfg.barbellConfig ?? BARBELL_CONFIG,
      });
      targets = aggregateTargetNotionals(decision);
      decisionReason = decision.reason;
    }

    const positions = await this.client.positions();
    const recon = reconcile(targets, positions, quoteBySymbol, this.cfg.contracts, this.cfg.symbols);

    const armed = this.liveArmed();
    const orders: BarbellCycleReport["orders"] = [];
    let ordersPlaced = 0;

    for (const o of recon) {
      if (!armed) {
        orders.push({ ...o, action: "dry" });
        continue;
      }
      try {
        const res = await this.client.placeOrder({ symbol: o.symbol, side: o.side, type: "market", volume: o.lots });
        if (res.executed) {
          ordersPlaced += 1;
          orders.push({ ...o, action: "placed", detail: `order=${res.order ?? "?"}` });
        } else {
          orders.push({ ...o, action: "refused", detail: res.guard ?? res.comment ?? `retcode ${res.retcode ?? "?"}` });
        }
      } catch (err) {
        orders.push({ ...o, action: "error", detail: (err as Error).message });
      }
    }

    return {
      equity,
      ourReturnPct,
      liveArmed: armed,
      decisionReason,
      marginLevelPct: account.margin_level,
      breakerTripped: breaker.tripped,
      orders,
      ordersPlaced,
    };
  }

  /** Run on a cadence; never throws out of the loop. Returns a stop fn. */
  runLoop(intervalMs: number, onCycle?: (r: BarbellCycleReport) => void): () => void {
    if (this.running) return () => {};
    this.running = true;
    const tick = async () => {
      try {
        const r = await this.runCycle();
        onCycle?.(r);
      } catch (err) {
        this.log(`[barbell] cycle error (continuing): ${(err as Error).message}`);
      }
    };
    void tick();
    const handle = setInterval(() => void tick(), intervalMs);
    return () => {
      this.running = false;
      clearInterval(handle);
    };
  }
}
