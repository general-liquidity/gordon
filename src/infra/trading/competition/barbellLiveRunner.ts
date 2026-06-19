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
import type { RvHysteresisState } from "./rvReversionCore.ts";
import { marginCircuitBreaker } from "./survivalStop.ts";
import { computeStanding, type CompetitionStanding } from "./standingMonitor.ts";
import type { RiskSample } from "../../../core/risk-management/competition-scoring.ts";
import { clampToDepth } from "./depthSizing.ts";
import { SlippageTracker } from "./slippageTracker.ts";
import { calibrateReturnField } from "./standingFieldCalibrator.ts";
import { makerLimitPrice, unhedgeCompletion, type MakerLeg } from "./makerExecution.ts";
import type { FieldModel } from "./rankTracker.ts";
import type { Mt5Depth, Mt5Order } from "../../broker/mt5/bridgeClient.ts";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { filterToAvailableSymbols, formatExcludedNote } from "./dataAvailability.ts";

/** Mockable subset of the bridge the runner needs (same shape as liveTrader's Mt5Like). */
export interface Mt5Like {
  account(): Promise<Mt5Account>;
  positions(): Promise<Mt5Position[]>;
  quote(symbol: string): Promise<Mt5Quote>;
  bars(params: { symbol: string; timeframe?: string; count?: number }): Promise<Mt5Bar[]>;
  placeOrder(req: Mt5OrderRequest): Promise<Mt5OrderResult>;
  /** Optional L2 depth — when present, orders are sized to fillable depth (FOK/IOC safety). */
  depth?(symbol: string): Promise<Mt5Depth>;
  /** Optional pending-order query + cancel — required for MAKER mode (rest/cancel limit orders). */
  orders?(): Promise<Mt5Order[]>;
  cancel?(ticket: number): Promise<Mt5OrderResult>;
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
  /** Bars until the decisive Top-100 cut (enables the pre-finals endgame sleeve + standing). */
  barsToCut?: () => number;
  /** Field size for rank estimates (default 500). */
  fieldN?: number;
  /** Cut line as a percentile (default 0.8 = Top-100 of 500). */
  cutPercentile?: number;
  /** Live peer-return leaderboard (rounds 1-3) for an EMPIRICAL return rank, if wired. */
  board?: () => { returns: number[] } | undefined;
  /**
   * Path to persist the equity + risk history (JSON) so a process RESTART mid-comp doesn't
   * lose the standing/Sharpe history. Loaded on construction, rewritten each cycle. Omit → none.
   */
  statePath?: string;
  /**
   * Path to a manual KILL-SWITCH flag file. If it exists at cycle time, the whole book is
   * flattened (operator panic-button, complementing the automatic margin breaker). Also tripped
   * by `GORDON_COMP_FLATTEN=1`. Touch the file to flatten; remove it to resume.
   */
  flattenFlagPath?: string;
  /**
   * Critical-event sink — fired on breaker trips, kill-switch, margin pressure, sleeve deploy, and
   * order failures (so the operator doesn't have to watch 24/7). Omit → alerts fall back to `log`
   * with a loud `[ALERT]` prefix. Alerts fire on TRANSITION into a condition, not every cycle.
   */
  alert?: (a: AlertEvent) => void;
  /** Margin level (percent) below which a MARGIN_PRESSURE warn fires (above the breaker). Default 80. */
  warnMarginLevelPct?: number;
  /**
   * Execution mode (callback, evaluated per cycle so it can be switched live). "taker" (DEFAULT) =
   * market orders. "maker" = rest LIMIT orders to EARN the spread — only when the book is acceptably
   * hedged; partial-fill drift past the band falls back to taker that cycle (un-hedge guard). Requires
   * the bridge's `orders()`+`cancel()`. Validate maker fills with `maker-probe.ts` before switching.
   */
  execution?: () => "taker" | "maker";
  /** Maker only: improve the resting limit toward mid by this many bps (0 = rest at touch, max rebate). */
  makerInsideBps?: number;
  /** Consecutive failed cycles before a CRITICAL CONNECTION_LOST alert (the disconnect watchdog). Default 3. */
  disconnectAlertCycles?: number;
}

export interface AlertEvent {
  level: "warn" | "critical";
  event: string;
  detail: string;
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
  /** True ⇒ the manual kill-switch fired and the book was flattened. */
  manualFlatten: boolean;
  orders: Array<ReconcileOrder & { action: "placed" | "dry" | "refused" | "error"; detail?: string }>;
  ordersPlaced: number;
  /** Live competition standing computed from the running equity curve (§11-17 + estimated rank). */
  standing: CompetitionStanding;
}

export class BarbellLiveRunner {
  private readonly client: Mt5Like;
  private readonly cfg: BarbellRunnerConfig;
  private readonly log: (m: string) => void;
  private running = false;
  /** Persistent per-pair hysteresis state for the RV core (held across cycles). */
  private readonly rvState: RvHysteresisState = new Map();
  /** 15-min equity samples + risk samples accumulated across cycles (for the standing monitor). */
  private readonly equityHistory: number[] = [];
  private readonly riskHistory: RiskSample[] = [];
  /** Realized-slippage accountant — records every fill vs the pre-trade mid to validate cost live. */
  private readonly slippage = new SlippageTracker();
  /** Alert edge-detection state (fire on transition INTO a condition, not every cycle). */
  private alertedBreaker = false;
  private alertedFlatten = false;
  private alertedMargin = false;
  private lastSleeveActive = false;
  private persistWarned = false;
  private consecutiveFailures = 0;

  constructor(client: Mt5Like, cfg: BarbellRunnerConfig, log: (m: string) => void = (m) => console.log(m)) {
    this.client = client;
    this.cfg = cfg;
    this.log = log;
    // Restart-safe: reload the equity/risk history + RV hysteresis state so the standing/Sharpe
    // and the low-churn pair holds survive a restart.
    if (cfg.statePath && existsSync(cfg.statePath)) {
      try {
        const s = JSON.parse(readFileSync(cfg.statePath, "utf8")) as { equityHistory?: number[]; riskHistory?: RiskSample[]; rvState?: unknown };
        if (Array.isArray(s.equityHistory)) this.equityHistory.push(...s.equityHistory.filter((x) => Number.isFinite(x)));
        if (Array.isArray(s.riskHistory)) this.riskHistory.push(...s.riskHistory);
        if (Array.isArray(s.rvState)) {
          for (const entry of s.rvState) {
            if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "number" || !Number.isFinite(entry[1])) continue;
            const side = Math.sign(entry[1]);
            if (side !== 0) this.rvState.set(entry[0], side);
          }
        }
        this.log(`[barbell] restored ${this.equityHistory.length} equity samples + ${this.rvState.size} RV states from ${cfg.statePath}`);
      } catch (err) {
        this.log(`[barbell] could not restore state (${(err as Error).message}); starting fresh`);
      }
    }
  }

  private liveArmed(): boolean {
    return process.env.GORDON_LIVE_TRADING === "1";
  }

  /** Realized-slippage summary so far (validates the live execution-cost assumption). */
  slippageSummary(): ReturnType<SlippageTracker["summary"]> {
    return this.slippage.summary();
  }

  /** Manual kill-switch: env flag or a flag file the operator can touch mid-comp to flatten. */
  private manualFlattenActive(): boolean {
    if (process.env.GORDON_COMP_FLATTEN === "1") return true;
    return this.cfg.flattenFlagPath ? existsSync(this.cfg.flattenFlagPath) : false;
  }

  /** Fire a critical-event alert (to the sink, or a loud log fallback). */
  private emitAlert(level: AlertEvent["level"], event: string, detail: string): void {
    if (this.cfg.alert) this.cfg.alert({ level, event, detail });
    else this.log(`[ALERT:${level.toUpperCase()}] ${event} — ${detail}`);
  }

  /** Persist the equity/risk history + RV hysteresis state (best-effort; never throws into the loop). */
  private persistState(): void {
    if (!this.cfg.statePath) return;
    try {
      mkdirSync(dirname(this.cfg.statePath), { recursive: true }); // ensure the parent dir exists
      const rvState = [...this.rvState.entries()]
        .filter(([, side]) => side !== 0)
        .map(([key, side]) => [key, Math.sign(side)]);
      writeFileSync(this.cfg.statePath, JSON.stringify({ equityHistory: this.equityHistory, riskHistory: this.riskHistory, rvState }));
    } catch (err) {
      // best-effort persistence — a write failure must never break the loop, but surface it ONCE
      // (a silently-failing persist would mean a restart loses the standing without warning).
      if (!this.persistWarned) {
        this.persistWarned = true;
        this.log(`[barbell] WARN: could not persist state to ${this.cfg.statePath} (${(err as Error).message}); standing will not survive a restart`);
      }
    }
  }

  async runCycle(): Promise<BarbellCycleReport> {
    const account = await this.client.account();
    const equity = account.equity;
    const ourReturnPct = this.cfg.startingEquity > 0 ? equity / this.cfg.startingEquity - 1 : 0;
    this.equityHistory.push(equity); // 15-min sample for the standing monitor

    const barsBySymbol: Record<string, Mt5Bar[]> = {};
    const quoteBySymbol: Record<string, Mt5Quote> = {};
    for (const symbol of this.cfg.symbols) {
      barsBySymbol[symbol] = await this.client.bars({ symbol, timeframe: this.cfg.timeframe, count: this.cfg.barsLookback });
      quoteBySymbol[symbol] = await this.client.quote(symbol);
    }

    // Data-availability guard: drop instruments whose live feed is missing/thin so the
    // decision never sizes off a degenerate window. Derived from availability, not a hardcoded
    // list. Reconcile still runs over the FULL universe below, so an excluded symbol we happen
    // to hold is still flattened — we just won't open NEW exposure in it.
    const { available, excluded } = filterToAvailableSymbols(this.cfg.symbols, barsBySymbol, this.cfg.barsLookback);
    const note = formatExcludedNote(excluded);
    if (note) this.log(`[barbell] ${note}`);
    const availableBars: Record<string, Mt5Bar[]> = {};
    for (const s of available) availableBars[s] = barsBySymbol[s]!;

    // Shared mid-price helper (order sizing, slippage reference, risk concentration).
    const mid = (sym: string, fallback: number): number => {
      const q = quoteBySymbol[sym];
      return q && q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : fallback;
    };

    // Intended execution mode for THIS cycle (taker default). Evaluated once and reused below so
    // the per-cycle `execution` callback isn't called twice. It drives the RV core's spread gate:
    // in TAKER we pay the spread, so a net-negative pair must not OPEN; in MAKER we EARN it → gate off.
    const armed = this.liveArmed();
    const intendedExecution =
      armed && this.client.orders && this.client.cancel ? (this.cfg.execution?.() ?? "taker") : "taker";
    // Live quoted bid-ask spread per symbol (bps) — same formula as competition-spread-check.
    const spreadBps: Record<string, number> = {};
    for (const [sym, q] of Object.entries(quoteBySymbol)) {
      const m = q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : 0;
      if (m > 0) spreadBps[sym] = ((q.ask - q.bid) / m) * 10_000;
    }

    // REAL standing: when a live peer-return board is wired, calibrate the field from it so the
    // sleeve DECISION (and the standing) use actual rank — not the placeholder model. Without real
    // data, `field` is undefined and we GATE the endgame sleeve off (finals-only) so the one-shot
    // can never auto-deploy on a model alone (see OPERATIONS §9). The operator wires the board.
    const board = this.cfg.board?.();
    const field: FieldModel | undefined = board && board.returns.length >= 2 ? calibrateReturnField(board.returns) : undefined;

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
    const manualFlatten = this.manualFlattenActive();

    // Critical-event alerts (edge-detected — fire on transition INTO the condition).
    if (breaker.tripped && !this.alertedBreaker) this.emitAlert("critical", "SURVIVAL_BREAKER", breaker.reason);
    this.alertedBreaker = breaker.tripped;
    if (manualFlatten && !this.alertedFlatten) this.emitAlert("critical", "KILL_SWITCH", "manual flatten active — book being flattened");
    this.alertedFlatten = manualFlatten;
    const warnLevel = this.cfg.warnMarginLevelPct ?? 80;
    const marginPressure = account.margin > 0 && account.margin_level > 0 && account.margin_level <= warnLevel && !breaker.tripped;
    if (marginPressure && !this.alertedMargin) this.emitAlert("warn", "MARGIN_PRESSURE", `margin level ${account.margin_level.toFixed(1)}% ≤ ${warnLevel}% (stop-out 30% = elimination)`);
    this.alertedMargin = marginPressure;

    let targets: Record<string, number>;
    let decisionReason: string;
    if (breaker.tripped || manualFlatten) {
      const why = manualFlatten ? "MANUAL KILL SWITCH — flatten all (operator)" : breaker.reason;
      this.log(`[barbell] ${manualFlatten ? "KILL SWITCH" : "SURVIVAL CIRCUIT BREAKER"} — ${why}`);
      targets = {}; // flatten everything
      decisionReason = why;
      this.lastSleeveActive = false;
    } else {
      const decision = barbellDecision({
        barsBySymbol: availableBars,
        equity,
        startingEquity: this.cfg.startingEquity,
        ourReturnPct,
        barsToDeadline: this.cfg.barsToDeadline(),
        // Endgame sleeve ONLY when we have real field data (board) — never auto-fire the one-shot
        // on the placeholder model. No board ⇒ finals-only; the operator decides manually.
        barsToCut: field ? this.cfg.barsToCut?.() : undefined,
        field, // calibrated from the live board when present; else assessStanding falls back to the model
        phase: this.cfg.phase(),
        config: this.cfg.barbellConfig ?? BARBELL_CONFIG,
        rvState: this.rvState, // discrete hysteresis — hold through the reversion, don't churn
        // Spread gate (taker only): don't OPEN a pair whose live leg spread is net-negative.
        // Omitted in maker mode (spread is earned) so the gate stays off there.
        rvSpreadBps: intendedExecution === "taker" ? spreadBps : undefined,
      });
      targets = aggregateTargetNotionals(decision);
      decisionReason = decision.reason;
      const sleeveActive = decision.sleeve != null;
      if (sleeveActive && !this.lastSleeveActive) this.emitAlert("warn", "SLEEVE_DEPLOYED", decision.sleeve!.reason);
      this.lastSleeveActive = sleeveActive;
    }

    const positions = await this.client.positions();
    const recon = reconcile(targets, positions, quoteBySymbol, this.cfg.contracts, this.cfg.symbols);

    const orders: BarbellCycleReport["orders"] = [];
    let ordersPlaced = 0;

    // ── Execution mode + un-hedge guard (maker only; taker is the default, go-live posture). ──
    // `intendedExecution` was resolved once at the top of the cycle (same callback, evaluated once).
    const execution = intendedExecution;
    let makerActive = false;
    if (execution === "maker") {
      // Cancel our prior resting limits — re-post fresh toward the CURRENT targets each cycle.
      try {
        for (const p of await this.client.orders!()) await this.client.cancel!(p.ticket);
      } catch (err) {
        this.log(`[barbell] maker: cancel-pending failed (${(err as Error).message})`);
      }
      // Un-hedge guard (tested module): if partial fills left the book net-directional past the band,
      // this returns completion orders → fall back to TAKER this cycle to lock neutrality; [] ⇒ rest as maker.
      const signedPos = (sym: string): number => {
        let n = 0;
        for (const p of positions) if (p.symbol === sym) n += (p.sideLabel === "long" ? 1 : -1) * Math.abs(p.volume) * mid(sym, p.price_current) * (this.cfg.contracts[sym]?.contractSize ?? 1);
        return n;
      };
      const legs: MakerLeg[] = this.cfg.symbols.map((s) => ({ symbol: s, targetNotional: targets[s] ?? 0, filledNotional: signedPos(s) }));
      makerActive = unhedgeCompletion(legs).length === 0;
      if (!makerActive) this.log(`[barbell] maker: net drift past band → taker-completing to restore neutrality this cycle`);
    }

    for (const o of recon) {
      if (!armed) {
        orders.push({ ...o, action: "dry" });
        continue;
      }
      // Depth-aware sizing: clamp to fillable depth so a FOK/IOC order doesn't bounce above the
      // book. Graceful — if no depth feed, place full size; the idempotent reconcile closes any
      // remaining gap next cycle.
      let lots = o.lots;
      let detailSuffix = "";
      if (this.client.depth) {
        try {
          const d = await this.client.depth(o.symbol);
          const clamp = clampToDepth(o.lots, o.side, o.side === "buy" ? d.asks : d.bids, { fillFraction: 0.8 });
          if (clamp.fillableLots <= 0) {
            orders.push({ ...o, action: "refused", detail: "no depth to fill" });
            continue;
          }
          if (clamp.capped) {
            detailSuffix = ` (depth-capped ${o.lots}→${clamp.fillableLots})`;
            lots = clamp.fillableLots;
          }
        } catch {
          /* no depth → place full size */
        }
      }
      const refMid = mid(o.symbol, 0);
      if (makerActive) {
        // MAKER: rest a passive limit (earn the spread when crossed). "placed" = resting, NOT
        // necessarily filled — fills appear as positions on a later cycle; no slippage recorded here.
        const q = quoteBySymbol[o.symbol];
        const limitPrice = q && q.bid > 0 && q.ask > 0 ? makerLimitPrice(o.side, q, { insideBps: this.cfg.makerInsideBps }) : refMid;
        try {
          const res = await this.client.placeOrder({ symbol: o.symbol, side: o.side, type: "limit", price: limitPrice, volume: lots, filling: "return" });
          if (res.executed || res.order != null) {
            ordersPlaced += 1;
            orders.push({ ...o, lots, action: "placed", detail: `maker rest @${limitPrice.toFixed(5)}${detailSuffix}` });
          } else {
            orders.push({ ...o, lots, action: "refused", detail: res.guard ?? res.comment ?? "maker limit rejected" });
          }
        } catch (err) {
          orders.push({ ...o, lots, action: "error", detail: (err as Error).message });
        }
      } else {
        try {
          const res = await this.client.placeOrder({ symbol: o.symbol, side: o.side, type: "market", volume: lots });
          if (res.executed) {
            ordersPlaced += 1;
            if (res.price && res.price > 0 && refMid > 0) {
              this.slippage.record({ symbol: o.symbol, side: o.side, refPrice: refMid, fillPrice: res.price, volume: res.volume ?? lots });
            }
            orders.push({ ...o, lots, action: "placed", detail: `order=${res.order ?? "?"}${detailSuffix}` });
          } else {
            orders.push({ ...o, lots, action: "refused", detail: res.guard ?? res.comment ?? `retcode ${res.retcode ?? "?"}` });
          }
        } catch (err) {
          orders.push({ ...o, lots, action: "error", detail: (err as Error).message });
        }
      }
    }

    const orderIssues = orders.filter((o) => o.action === "refused" || o.action === "error").length;
    if (orderIssues > 0 && armed) this.emitAlert("warn", "ORDER_ISSUE", `${orderIssues} order(s) refused/errored this cycle`);

    // ── Live risk sample (§13 inputs) + standing, computed from the actual book. ──
    const signedBySym: Record<string, number> = {};
    let grossNotional = 0;
    for (const p of positions) {
      const cs = this.cfg.contracts[p.symbol]?.contractSize ?? 1;
      const notional = Math.abs(p.volume) * mid(p.symbol, p.price_current) * cs;
      grossNotional += notional;
      signedBySym[p.symbol] = (signedBySym[p.symbol] ?? 0) + (p.sideLabel === "long" ? notional : -notional);
    }
    const marginUsage = equity > 0 && account.margin > 0 ? account.margin / equity : 0;
    const leverage = equity > 0 ? grossNotional / equity : 0;
    const singleInstrumentExposure = grossNotional > 0 ? Math.max(0, ...Object.values(signedBySym).map(Math.abs)) / grossNotional : 0;
    const netDirectionalExposure = grossNotional > 0 ? Math.abs(Object.values(signedBySym).reduce((s, v) => s + v, 0)) / grossNotional : 0;
    this.riskHistory.push({ marginUsage, leverage, singleInstrumentExposure, netDirectionalExposure });

    const standing = computeStanding({
      equity15m: this.equityHistory,
      riskSamples: this.riskHistory,
      riskIntervalMinutes: 15,
      startingEquity: this.cfg.startingEquity,
      phase: this.cfg.phase(),
      cutPercentile: this.cfg.cutPercentile,
      fieldN: this.cfg.fieldN,
      // Match the decision: endgame readout only with real data; standing uses the calibrated field.
      barsToCut: field ? this.cfg.barsToCut?.() : undefined,
      field,
      board,
      liveRisk: { marginUsage, leverage },
    });

    this.persistState(); // restart-safe equity/risk history

    return {
      equity,
      ourReturnPct,
      liveArmed: armed,
      decisionReason,
      marginLevelPct: account.margin_level,
      breakerTripped: breaker.tripped,
      manualFlatten,
      orders,
      ordersPlaced,
      standing,
    };
  }

  /** Run on a cadence; never throws out of the loop. Returns a stop fn. */
  runLoop(intervalMs: number, onCycle?: (r: BarbellCycleReport) => void): () => void {
    if (this.running) return () => {};
    this.running = true;
    const tick = async () => {
      try {
        const r = await this.runCycle();
        if (this.consecutiveFailures > 0) this.emitAlert("warn", "CONNECTION_RESTORED", `recovered after ${this.consecutiveFailures} failed cycle(s)`);
        this.consecutiveFailures = 0;
        this.log(r.standing.summary); // live standing every cycle
        const sl = this.slippage.summary();
        if (sl.fills > 0) this.log(`[barbell] realized slippage: ${sl.fills} fills · mean ${sl.meanSlippageBps.toFixed(2)}bps · cost ${sl.totalCostQuote.toFixed(0)}`);
        onCycle?.(r);
      } catch (err) {
        // DISCONNECT WATCHDOG: a sustained dropout is survival-critical — on a client-side disconnect
        // positions stay open and the margin breaker CANNOT run, so margin can drift to the stop-out
        // (= elimination) unattended. Escalate to a CRITICAL alert at the threshold + periodically after,
        // so the operator reconnects FAST or flattens manually. (A single hiccup just logs + retries.)
        this.consecutiveFailures += 1;
        this.log(`[barbell] cycle error (continuing): ${(err as Error).message}`);
        const k = this.cfg.disconnectAlertCycles ?? 3;
        if (this.consecutiveFailures >= k && this.consecutiveFailures % k === 0) {
          this.emitAlert(
            "critical",
            "CONNECTION_LOST",
            `${this.consecutiveFailures} consecutive failed cycles — the survival breaker CANNOT run while disconnected. Reconnect NOW or flatten from the MT5 terminal before margin runs to the stop-out (${(err as Error).message}).`,
          );
        }
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
