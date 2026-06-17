/**
 * Competition LIVE trade loop — the piece that turns the offline dry-run
 * (`src/backtest/competition-dry-run.ts`) into real fills via the MT5 bridge.
 *
 * The sizing/risk spine is identical to the dry-run: a per-symbol strategy
 * emits a signal, `sizeCompetitionTrade` (survive-and-compound sizing) sizes it
 * against equity / exposure / daily-loss-kill, and the result is converted to
 * lots and placed through the bridge. The only thing that changes from the
 * dry-run is the venue — so the money-path validated offline carries over.
 *
 * DOUBLE SAFETY GUARD. Two INDEPENDENT gates must both be open for a real order
 * to reach the broker:
 *   1. THIS process — `GORDON_LIVE_TRADING === "1"`. When unset, `runCycle`
 *      records the intended order as a DRY decision and never calls placeOrder.
 *   2. The sidecar — `MT5_BRIDGE_ALLOW_TRADING=1` (enforced in mt5_bridge.py).
 *      Even with gate 1 open, the bridge refuses and returns `{guard}` unless
 *      its own flag is set.
 * Either gate closed ⇒ no live order. Defense in depth: a single misconfigured
 * env var can't arm live trading.
 */

import {
  sizeCompetitionTrade,
  COMPETITION_RISK_SURVIVAL,
  type CompetitionRiskParams,
} from "../../../core/risk-management/competition-risk-preset.ts";
import { survivalStopDistance } from "./survivalStop.ts";
import type {
  Mt5Account,
  Mt5Position,
  Mt5Quote,
  Mt5Bar,
  Mt5OrderRequest,
  Mt5OrderResult,
} from "../../broker/mt5/bridgeClient.ts";

/**
 * Mockable subset of `Mt5BridgeClient`. Only the methods the live loop needs —
 * keeps tests free of network and the full client surface.
 */
export interface Mt5Like {
  account(): Promise<Mt5Account>;
  positions(): Promise<Mt5Position[]>;
  quote(symbol: string): Promise<Mt5Quote>;
  bars(params: { symbol: string; timeframe?: string; count?: number }): Promise<Mt5Bar[]>;
  placeOrder(req: Mt5OrderRequest): Promise<Mt5OrderResult>;
}

export interface LiveSignal {
  side: "long" | "short";
  /** Price distance from entry to the protective stop (> 0). */
  stopDistance: number;
  /** Price distance from entry to the take-profit (> 0). Optional. */
  targetDistance?: number;
  /** Optional edge for the Kelly cap in the sizing decision. */
  edge?: { winProb: number; payoffRatio: number };
}

/** Per-symbol strategy. Return a signal to OPEN a position, or null to do nothing. */
export type SignalFn = (recentBars: Mt5Bar[]) => LiveSignal | null;

/** Minimal contract spec needed to round a unit size to a valid lot. */
export interface ContractSpec {
  volume_min: number;
  volume_step: number;
  /** Units of the base instrument per 1.0 lot (MT5 trade_contract_size). Default 1. */
  contractSize?: number;
}

export interface LiveTraderConfig {
  /** `"maker"` posts a limit just inside the spread; `"taker"` sends a market order. */
  execution: "maker" | "taker";
  /** How many recent bars to feed the strategy. */
  barsLookback: number;
  /** Daily loss (fraction of equity) that halts NEW entries for the UTC day. */
  dailyLossKillPct: number;
  /** Bar timeframe to request from the bridge. Default "M15". */
  timeframe?: string;
  /**
   * Annualized instrument volatility used for vol-target sizing. Single number
   * applied to all symbols, or a per-symbol map. Defaults to 0.5 when absent.
   */
  instrumentVolAnnual?: number | Record<string, number>;
  /**
   * Fraction of the spread to step inside for a maker post (0–0.5). Default 0.25
   * → buy at ask − 0.25·spread, sell at bid + 0.25·spread.
   */
  makerSpreadFraction?: number;
  /**
   * Survival-stop placement: fraction of the move-to-the-stop-out at which to cap the
   * protective stop (see `survivalStop.ts`, default 0.6). The attached SL is always the
   * TIGHTER of the strategy stop and this survival stop — it only ever tightens protection.
   */
  survivalStopFraction?: number;
}

export interface CompetitionLiveTraderOptions {
  client: Mt5Like;
  /** Symbols the loop is allowed to trade. */
  symbols: string[];
  /** Per-symbol strategy callbacks. */
  signals: Record<string, SignalFn>;
  /** Per-symbol contract specs for lot rounding. */
  contracts: Record<string, ContractSpec>;
  config: LiveTraderConfig;
  /** Risk preset. Defaults to COMPETITION_RISK_SURVIVAL (the frozen competition posture). */
  riskParams?: CompetitionRiskParams;
  /** Injectable logger (defaults to console). */
  log?: (msg: string) => void;
}

export interface CycleDecision {
  symbol: string;
  action: "placed" | "dry" | "skipped" | "halted" | "no_signal" | "error";
  lots?: number;
  side?: "buy" | "sell";
  reason: string;
}

export interface CycleReport {
  equity: number;
  dailyPnL: number;
  openExposureNotional: number;
  halted: boolean;
  liveArmed: boolean;
  decisions: CycleDecision[];
  ordersPlaced: number;
}

/** Day key (UTC) for the daily-loss-kill baseline reset. */
function utcDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export class CompetitionLiveTrader {
  private readonly client: Mt5Like;
  private readonly symbols: string[];
  private readonly signals: Record<string, SignalFn>;
  private readonly contracts: Record<string, ContractSpec>;
  private readonly config: LiveTraderConfig;
  private readonly riskParams: CompetitionRiskParams;
  private readonly log: (msg: string) => void;

  /** Per-UTC-day starting equity, for dailyPnL = equity − dayStartEquity. */
  private dayKey: string | null = null;
  private dayStartEquity = 0;
  private running = false;

  constructor(opts: CompetitionLiveTraderOptions) {
    this.client = opts.client;
    this.symbols = opts.symbols;
    this.signals = opts.signals;
    this.contracts = opts.contracts;
    this.config = opts.config;
    this.riskParams = opts.riskParams ?? COMPETITION_RISK_SURVIVAL;
    this.log = opts.log ?? ((m) => console.log(m));
  }

  /** Gate 1 of the double safety guard — this process must opt in to live orders. */
  private liveArmed(): boolean {
    return process.env.GORDON_LIVE_TRADING === "1";
  }

  private volFor(symbol: string): number {
    const v = this.config.instrumentVolAnnual;
    if (typeof v === "number") return v;
    if (v && typeof v[symbol] === "number") return v[symbol]!;
    return 0.5;
  }

  /** Round a unit size to a valid lot: snap to volume_step, floor to ≥ volume_min. */
  private unitsToLots(units: number, spec: ContractSpec): number {
    const contractSize = spec.contractSize && spec.contractSize > 0 ? spec.contractSize : 1;
    const rawLots = units / contractSize;
    const step = spec.volume_step > 0 ? spec.volume_step : spec.volume_min;
    const stepped = Math.floor(rawLots / step) * step;
    // Decimal places implied by the step, to avoid float dust (e.g. 0.30000000004).
    const decimals = Math.max(0, Math.ceil(-Math.log10(step)) || 0);
    const rounded = parseFloat(stepped.toFixed(decimals));
    return rounded < spec.volume_min ? 0 : rounded;
  }

  private absPositionNotional(p: Mt5Position): number {
    const price = p.price_current || p.price_open;
    return Math.abs(p.volume * price);
  }

  async runCycle(now = Date.now()): Promise<CycleReport> {
    const account = await this.client.account();
    const equity = account.equity;

    // Per-UTC-day baseline for the daily-loss-kill.
    const key = utcDayKey(now);
    if (this.dayKey !== key) {
      this.dayKey = key;
      this.dayStartEquity = equity;
    }
    const dailyPnL = equity - this.dayStartEquity;

    const positions = await this.client.positions();
    const openExposureNotional = positions.reduce((sum, p) => sum + this.absPositionNotional(p), 0);
    const openSymbols = new Set(positions.map((p) => p.symbol));

    const armed = this.liveArmed();
    const decisions: CycleDecision[] = [];
    let ordersPlaced = 0;

    // Daily-loss kill: halt NEW entries for the rest of the day (existing positions untouched).
    const halted = dailyPnL <= -this.config.dailyLossKillPct * equity;
    if (halted) {
      for (const symbol of this.symbols) {
        decisions.push({
          symbol,
          action: "halted",
          reason: `daily-loss kill: dailyPnL ${dailyPnL.toFixed(2)} ≤ −${(this.config.dailyLossKillPct * 100).toFixed(1)}% of equity`,
        });
      }
      this.log(`[live] HALTED for ${key} — daily-loss kill (dailyPnL ${dailyPnL.toFixed(2)})`);
      return { equity, dailyPnL, openExposureNotional, halted, liveArmed: armed, decisions, ordersPlaced };
    }

    for (const symbol of this.symbols) {
      try {
        if (openSymbols.has(symbol)) {
          decisions.push({ symbol, action: "skipped", reason: "position already open" });
          continue;
        }
        const signalFn = this.signals[symbol];
        const spec = this.contracts[symbol];
        if (!signalFn || !spec) {
          decisions.push({ symbol, action: "skipped", reason: !signalFn ? "no strategy registered" : "no contract spec" });
          continue;
        }

        const bars = await this.client.bars({ symbol, timeframe: this.config.timeframe ?? "M15", count: this.config.barsLookback });
        const signal = signalFn(bars);
        if (!signal) {
          decisions.push({ symbol, action: "no_signal", reason: "strategy returned null" });
          continue;
        }

        const quote = await this.client.quote(symbol);
        const price = signal.side === "long" ? quote.ask : quote.bid;
        if (!(price > 0)) {
          decisions.push({ symbol, action: "skipped", reason: "no live price (bid/ask 0)" });
          continue;
        }

        const sizing = sizeCompetitionTrade({
          equity,
          price,
          stopDistance: signal.stopDistance,
          instrumentVolAnnual: this.volFor(symbol),
          openExposureNotional,
          dailyPnL,
          edge: signal.edge,
          params: this.riskParams,
        });

        if (sizing.verdict !== "trade") {
          decisions.push({ symbol, action: "skipped", reason: `sizing verdict ${sizing.verdict}: ${sizing.interpretation}` });
          continue;
        }

        const lots = this.unitsToLots(sizing.sizeUnits, spec);
        if (lots <= 0) {
          decisions.push({ symbol, action: "skipped", reason: `sized ${sizing.sizeUnits} units → below volume_min ${spec.volume_min}` });
          continue;
        }

        const side: "buy" | "sell" = signal.side === "long" ? "buy" : "sell";
        const order = this.buildOrder({ symbol, side, lots, signal, quote, equity });

        if (!armed) {
          decisions.push({
            symbol,
            action: "dry",
            lots,
            side,
            reason: `DRY (GORDON_LIVE_TRADING unset): would ${order.type} ${side} ${lots} lots @ ${order.price ?? "mkt"} sl=${order.sl} tp=${order.tp}`,
          });
          this.log(`[live] DRY ${symbol} ${side} ${lots} lots (${order.type}) — set GORDON_LIVE_TRADING=1 to arm`);
          continue;
        }

        const result = await this.client.placeOrder(order);
        if (result.executed) {
          ordersPlaced += 1;
          decisions.push({ symbol, action: "placed", lots, side, reason: `${order.type} ${side} ${lots} lots order=${result.order ?? "?"}` });
          this.log(`[live] PLACED ${symbol} ${side} ${lots} lots (${order.type}) order=${result.order ?? "?"}`);
        } else {
          // Sidecar gate 2 (or a broker reject) — surfaced, not thrown.
          decisions.push({ symbol, action: "skipped", reason: `bridge refused: ${result.guard ?? result.comment ?? `retcode ${result.retcode ?? "?"}`}` });
          this.log(`[live] REFUSED ${symbol} — ${result.guard ?? result.comment ?? "broker reject"} (is MT5_BRIDGE_ALLOW_TRADING=1?)`);
        }
      } catch (err) {
        decisions.push({ symbol, action: "error", reason: (err as Error).message });
        this.log(`[live] ERROR ${symbol}: ${(err as Error).message}`);
      }
    }

    return { equity, dailyPnL, openExposureNotional, halted, liveArmed: armed, decisions, ordersPlaced };
  }

  private buildOrder(args: {
    symbol: string;
    side: "buy" | "sell";
    lots: number;
    signal: LiveSignal;
    quote: Mt5Quote;
    equity: number;
  }): Mt5OrderRequest {
    const { symbol, side, lots, signal, quote, equity } = args;
    const clientOrderId = `gordon_comp_${symbol}_${Date.now()}`;

    // Entry reference: long fills at ask, short at bid (taker), maker posts inside.
    const entry = side === "buy" ? quote.ask : quote.bid;

    // Protective stop = the TIGHTER of the strategy stop and the SURVIVAL stop (the move that
    // would drag the account toward the 30% margin stop-out = elimination). Only ever tightens:
    // if there's no position/equity the survival distance is Infinity and the strategy stop wins.
    const contractSize = this.contracts[symbol]?.contractSize ?? 1;
    const survivalFrac = survivalStopDistance({
      positionNotional: lots * contractSize * entry,
      equity,
      survivalFraction: this.config.survivalStopFraction,
    });
    const stopDistance = Math.min(signal.stopDistance, entry * survivalFrac);
    const sl = side === "buy" ? entry - stopDistance : entry + stopDistance;
    const tp =
      signal.targetDistance === undefined
        ? undefined
        : side === "buy"
          ? entry + signal.targetDistance
          : entry - signal.targetDistance;

    if (this.config.execution === "taker") {
      return { symbol, side, type: "market", volume: lots, sl, tp, clientOrderId };
    }

    // Maker: post a limit just inside the spread (buy below ask / sell above bid).
    const frac = this.config.makerSpreadFraction ?? 0.25;
    const spread = Math.max(0, quote.ask - quote.bid);
    const price = side === "buy" ? quote.ask - spread * frac : quote.bid + spread * frac;
    return { symbol, side, type: "limit", volume: lots, price, sl, tp, clientOrderId };
  }

  /**
   * Run `runCycle` on a cadence. NEVER throws out of the loop — a cycle error is
   * logged and the next tick proceeds (reconnect-tolerant). Returns a stop fn.
   */
  runLoop(intervalMs: number, opts?: { onCycle?: (report: CycleReport) => void }): () => void {
    if (this.running) return () => {};
    this.running = true;

    const tick = async (): Promise<void> => {
      try {
        const report = await this.runCycle();
        opts?.onCycle?.(report);
      } catch (err) {
        this.log(`[live] cycle error (continuing): ${(err as Error).message}`);
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
