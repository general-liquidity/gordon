#!/usr/bin/env bun
/**
 * Competition PAPER-MODE REHEARSAL — drive the REAL live trader
 * (`CompetitionLiveTrader`) end-to-end through historical M15 bars via a replay
 * bridge that stands in for the MT5 sidecar.
 *
 *   bun run scripts/competition/rehearsal.ts
 *
 * This is DISTINCT from the offline dry-run (`src/backtest/competition-dry-run.ts`),
 * which re-implements the sizing/fill spine as a standalone simulator. Here we
 * exercise the ACTUAL live code path:
 *
 *   CompetitionLiveTrader.runCycle()
 *     → sizeCompetitionTrade (survive-and-compound sizing)
 *     → unitsToLots (lot rounding against the contract spec)
 *     → buildOrder (sl/tp from signal)
 *     → client.placeOrder()              ← against ReplayMt5, NOT a real broker
 *
 * The value: it catches LIVE-LOOP integration bugs the offline dry-run can't —
 * the order-shape contract between the trader and the bridge, the lot-rounding
 * round-trip, the per-symbol "skip if already open" gate, the daily-loss-kill
 * baseline, and the account/positions accounting the trader reads back.
 *
 * `ReplayMt5` implements the `Mt5Like` interface over `data/momq/bars/<SYM>_M15.json`:
 * a cursor advances one bar per cycle; `bars()` returns history up to the cursor;
 * `quote()` synthesizes bid/ask from the current close; `placeOrder()` SIMULATES a
 * fill and tracks in-memory positions + realized PnL; stop/target exits are applied
 * as the cursor moves over subsequent bars. No real MT5 is involved — we set
 * GORDON_LIVE_TRADING=1 so the trader "places" orders against the REPLAY.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Mt5Account,
  Mt5Position,
  Mt5Quote,
  Mt5Bar,
  Mt5OrderRequest,
  Mt5OrderResult,
} from "../../src/infra/broker/mt5/bridgeClient.ts";
import {
  CompetitionLiveTrader,
  type Mt5Like,
  type SignalFn,
  type ContractSpec,
} from "../../src/infra/trading/competition/liveTrader.ts";
import { type CompetitionRiskParams } from "../../src/core/risk-management/competition-risk-preset.ts";
import {
  makeTsmomSignal,
  COMPETITION_TRADEABLE,
  COMPETITION_LIVE_CONFIG,
  COMPETITION_RISK,
} from "../../src/infra/trading/competition/competitionStrategy.ts";
import {
  computeNonAnnualizedSharpe,
  computeReturn,
  computeMaxDrawdown,
} from "../../src/core/risk-management/competition-scoring.ts";

// ---------------------------------------------------------------------------
// ReplayMt5 — an Mt5Like bridge backed by historical bars.
// ---------------------------------------------------------------------------

export interface ReplaySymbolData {
  symbol: string;
  bars: Mt5Bar[];
  /** Units of base instrument per 1.0 lot (mirrors MT5 trade_contract_size). */
  contractSize: number;
  /** Half the synthetic bid/ask spread, in price units. */
  halfSpread: number;
}

interface ReplayPosition {
  ticket: number;
  symbol: string;
  side: "buy" | "sell";
  /** Lots. */
  volume: number;
  /** Units of base instrument = volume * contractSize. */
  units: number;
  entryPrice: number;
  sl: number;
  tp: number;
}

export interface ReplayMt5Options {
  startingEquity: number;
  symbols: ReplaySymbolData[];
  currency?: string;
  leverage?: number;
}

/**
 * A deterministic, in-memory MT5 bridge over historical bars. One position per
 * symbol at a time. The cursor advances each `step()`; exits (stop/target) are
 * evaluated against the bar the cursor moves ONTO, so the live loop — which only
 * ever OPENS positions — sees them close on their own, exactly as a real broker
 * would manage the bracket.
 */
export class ReplayMt5 implements Mt5Like {
  readonly startingEquity: number;
  private readonly data = new Map<string, ReplaySymbolData>();
  private readonly positions_ = new Map<string, ReplayPosition>();
  private cursor = 0;
  private realizedPnL = 0;
  private nextTicket = 1;
  private readonly currency: string;
  private readonly leverage: number;
  /** Max valid cursor across all symbols (longest series − 1). */
  readonly maxCursor: number;

  constructor(opts: ReplayMt5Options) {
    this.startingEquity = opts.startingEquity;
    this.currency = opts.currency ?? "USD";
    this.leverage = opts.leverage ?? 100;
    let maxLen = 0;
    for (const s of opts.symbols) {
      this.data.set(s.symbol, s);
      if (s.bars.length > maxLen) maxLen = s.bars.length;
    }
    this.maxCursor = Math.max(0, maxLen - 1);
  }

  /** Current cursor index (the "now" bar). */
  get index(): number {
    return this.cursor;
  }

  /** The current bar for a symbol (clamped to its last bar if the series is shorter). */
  currentBar(symbol: string): Mt5Bar | null {
    const d = this.data.get(symbol);
    if (!d || d.bars.length === 0) return null;
    const i = Math.min(this.cursor, d.bars.length - 1);
    return d.bars[i]!;
  }

  /** Mark-to-market price for a position (its symbol's current close). */
  private currentPrice(symbol: string): number {
    return this.currentBar(symbol)?.close ?? 0;
  }

  /** Unrealized PnL of one position at the current close. */
  private unrealized(p: ReplayPosition): number {
    const price = this.currentPrice(p.symbol);
    const dir = p.side === "buy" ? 1 : -1;
    return dir * (price - p.entryPrice) * p.units;
  }

  /**
   * Advance the cursor by one bar and apply bracket exits on the bar we land on.
   * A long exits at its stop if the bar's low touches it, at its target if the
   * high touches it (stop checked first — worst case). Short is mirrored.
   * Returns false when the timeline is exhausted.
   */
  step(): boolean {
    if (this.cursor >= this.maxCursor) return false;
    this.cursor += 1;
    for (const symbol of [...this.positions_.keys()]) {
      const pos = this.positions_.get(symbol)!;
      const bar = this.currentBar(symbol);
      if (!bar) continue;
      const exit = this.bracketExit(pos, bar);
      if (exit !== null) this.closeAt(pos, exit);
    }
    return true;
  }

  /** The fill price if `bar` triggers the position's stop/target, else null. */
  private bracketExit(pos: ReplayPosition, bar: Mt5Bar): number | null {
    if (pos.side === "buy") {
      if (pos.sl > 0 && bar.low <= pos.sl) return pos.sl;
      if (pos.tp > 0 && bar.high >= pos.tp) return pos.tp;
    } else {
      if (pos.sl > 0 && bar.high >= pos.sl) return pos.sl;
      if (pos.tp > 0 && bar.low <= pos.tp) return pos.tp;
    }
    return null;
  }

  /** Realize a position at `exitPrice` and remove it. */
  private closeAt(pos: ReplayPosition, exitPrice: number): number {
    const dir = pos.side === "buy" ? 1 : -1;
    const pnl = dir * (exitPrice - pos.entryPrice) * pos.units;
    this.realizedPnL += pnl;
    this.positions_.delete(pos.symbol);
    return pnl;
  }

  /** Sum of unrealized PnL across open positions, marked at current closes. */
  private openUnrealized(): number {
    let sum = 0;
    for (const p of this.positions_.values()) sum += this.unrealized(p);
    return sum;
  }

  /** Equity = startingEquity + realized + unrealized. */
  equityNow(): number {
    return this.startingEquity + this.realizedPnL + this.openUnrealized();
  }

  // --- Mt5Like surface ---

  async account(): Promise<Mt5Account> {
    const equity = this.equityNow();
    const margin = 0;
    return {
      login: 1,
      server: "replay",
      currency: this.currency,
      balance: this.startingEquity + this.realizedPnL,
      equity,
      margin,
      margin_free: equity - margin,
      margin_level: 0,
      profit: this.openUnrealized(),
      leverage: this.leverage,
    };
  }

  async positions(): Promise<Mt5Position[]> {
    const out: Mt5Position[] = [];
    for (const p of this.positions_.values()) {
      const price = this.currentPrice(p.symbol);
      out.push({
        ticket: p.ticket,
        symbol: p.symbol,
        type: p.side === "buy" ? 0 : 1,
        sideLabel: p.side === "buy" ? "long" : "short",
        volume: p.volume,
        price_open: p.entryPrice,
        price_current: price,
        profit: this.unrealized(p),
        sl: p.sl,
        tp: p.tp,
      });
    }
    return out;
  }

  async quote(symbol: string): Promise<Mt5Quote> {
    const bar = this.currentBar(symbol);
    const d = this.data.get(symbol);
    if (!bar || !d) {
      return { symbol, bid: 0, ask: 0, last: 0, time: 0, live: false };
    }
    const mid = bar.close;
    return {
      symbol,
      bid: mid - d.halfSpread,
      ask: mid + d.halfSpread,
      last: mid,
      time: bar.time,
      live: true,
    };
  }

  async bars(params: { symbol: string; timeframe?: string; count?: number }): Promise<Mt5Bar[]> {
    const d = this.data.get(params.symbol);
    if (!d) return [];
    const upTo = Math.min(this.cursor, d.bars.length - 1);
    const slice = d.bars.slice(0, upTo + 1);
    if (params.count && params.count > 0 && slice.length > params.count) {
      return slice.slice(slice.length - params.count);
    }
    return slice;
  }

  async placeOrder(req: Mt5OrderRequest): Promise<Mt5OrderResult> {
    const d = this.data.get(req.symbol);
    const bar = this.currentBar(req.symbol);
    if (!d || !bar) {
      return { executed: false, comment: `no replay data for ${req.symbol}` };
    }
    if (this.positions_.has(req.symbol)) {
      // One position per symbol — the live loop normally skips, but be defensive.
      return { executed: false, comment: `position already open for ${req.symbol}` };
    }

    const quote = await this.quote(req.symbol);
    let fillPrice: number;
    if (req.type === "market") {
      fillPrice = req.side === "buy" ? quote.ask : quote.bid;
    } else {
      // Limit: fill only if THIS bar reaches the price; otherwise leave it
      // resting/expire (rehearsal does not carry resting limits across cycles).
      const limit = req.price ?? (req.side === "buy" ? quote.ask : quote.bid);
      const reached = req.side === "buy" ? bar.low <= limit : bar.high >= limit;
      if (!reached) {
        return { executed: false, comment: `limit ${limit} not reached this bar (resting/expired)` };
      }
      fillPrice = limit;
    }

    const ticket = this.nextTicket++;
    const units = req.volume * d.contractSize;
    this.positions_.set(req.symbol, {
      ticket,
      symbol: req.symbol,
      side: req.side,
      volume: req.volume,
      units,
      entryPrice: fillPrice,
      sl: req.sl ?? 0,
      tp: req.tp ?? 0,
    });

    return {
      executed: true,
      retcode: 10009, // TRADE_RETCODE_DONE
      order: ticket,
      deal: ticket,
      volume: req.volume,
      price: fillPrice,
      comment: req.clientOrderId,
    };
  }
}

// ---------------------------------------------------------------------------
// Data loading + contract spec defaults.
// ---------------------------------------------------------------------------

const BARS_DIR = join(import.meta.dir, "..", "..", "data", "momq", "bars");

export function loadBars(symbol: string): Mt5Bar[] {
  const path = join(BARS_DIR, `${symbol}_M15.json`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as Mt5Bar[];
  return raw;
}

/**
 * Pick a coherent contract spec + synthetic half-spread per symbol. Crypto uses a
 * 0.01-lot step with contract size 1; FX/metals use a 0.01-lot step with the
 * standard 100k contract size. Half-spread is a few basis points of price so the
 * synthetic quote is sane without dominating PnL.
 */
export function specFor(symbol: string, samplePrice: number): { contract: ContractSpec; halfSpread: number } {
  const isCrypto = /BTC|ETH|SOL|XRP|BAR/.test(symbol);
  const contractSize = isCrypto ? 1 : 100_000;
  const halfSpreadBps = isCrypto ? 5 : 1; // 5bps crypto, 1bp FX, one-sided
  return {
    contract: { volume_min: 0.01, volume_step: 0.01, contractSize },
    halfSpread: (samplePrice * halfSpreadBps) / 10_000,
  };
}

// ---------------------------------------------------------------------------
// A simple, deterministic mean-reversion test signal.
// ---------------------------------------------------------------------------

/**
 * Fade the last close's deviation from the lookback mean. The point is to EXERCISE
 * the live loop deterministically, not to find alpha. Below mean → long, above →
 * short; stop/target scaled off the mean bar range.
 */
export const meanReversionSignal: SignalFn = (bars: Mt5Bar[]) => {
  if (bars.length < 10) return null;
  const closes = bars.map((b) => b.close);
  const mean = closes.reduce((a, c) => a + c, 0) / closes.length;
  const last = closes[closes.length - 1]!;
  const ranges = bars.map((b) => b.high - b.low).filter((r) => r > 0);
  const atr = ranges.length ? ranges.reduce((a, r) => a + r, 0) / ranges.length : Math.abs(last) * 0.001;
  const dev = last - mean;
  if (Math.abs(dev) < atr * 0.5) return null;
  return {
    side: dev < 0 ? "long" : "short",
    stopDistance: atr * 1.5,
    targetDistance: atr * 2.0,
  };
};

// ---------------------------------------------------------------------------
// Rehearsal runner.
// ---------------------------------------------------------------------------

export interface RehearsalResult {
  startingEquity: number;
  finalEquity: number;
  totalReturnPct: number;
  ordersPlaced: number;
  cycles: number;
  equityCurve: number[];
  competition: { returnPct: number; maxDrawdownPct: number; sharpe15m: number; sharpe15mObs: number };
  sampleDecisions: string[];
}

export interface RehearsalOptions {
  symbols?: string[];
  startingEquity?: number;
  /** Cap the number of cycles (default: full timeline). */
  maxCycles?: number;
  barsLookback?: number;
  execution?: "maker" | "taker";
  /** Strategy to rehearse. Defaults to the FROZEN competition TSMOM signal. */
  signal?: SignalFn;
  /** Risk preset. Defaults to the FROZEN COMPETITION_RISK (survive-and-rank). */
  riskParams?: CompetitionRiskParams;
  log?: (msg: string) => void;
}

export async function runRehearsal(opts: RehearsalOptions = {}): Promise<RehearsalResult> {
  // Default to the FROZEN competition config so the rehearsal exercises exactly what
  // goes live: the 15 tradeable instruments, the TSMOM signal, the survival preset.
  const symbols = opts.symbols ?? [...COMPETITION_TRADEABLE];
  const startingEquity = opts.startingEquity ?? 1_000_000;
  const barsLookback = opts.barsLookback ?? COMPETITION_LIVE_CONFIG.barsLookback;
  const execution = opts.execution ?? COMPETITION_LIVE_CONFIG.execution;
  const stratSignal = opts.signal ?? makeTsmomSignal();
  const riskParams = opts.riskParams ?? COMPETITION_RISK;
  const log = opts.log ?? (() => {});

  // Arm gate 1 so the trader places orders against the REPLAY bridge.
  process.env.GORDON_LIVE_TRADING = "1";

  const replaySymbols: ReplaySymbolData[] = [];
  const contracts: Record<string, ContractSpec> = {};
  const signals: Record<string, SignalFn> = {};

  for (const symbol of symbols) {
    const bars = loadBars(symbol);
    if (bars.length === 0) continue;
    const samplePrice = bars[Math.floor(bars.length / 2)]!.close;
    const { contract, halfSpread } = specFor(symbol, samplePrice);
    replaySymbols.push({ symbol, bars, contractSize: contract.contractSize ?? 1, halfSpread });
    contracts[symbol] = contract;
    signals[symbol] = stratSignal;
  }

  const replay = new ReplayMt5({ startingEquity, symbols: replaySymbols });

  const trader = new CompetitionLiveTrader({
    client: replay,
    symbols: replaySymbols.map((s) => s.symbol),
    signals,
    contracts,
    config: {
      execution,
      barsLookback,
      dailyLossKillPct: COMPETITION_LIVE_CONFIG.dailyLossKillPct,
      timeframe: "M15",
    },
    riskParams,
    log: () => {}, // keep the trader quiet; we summarize at the rehearsal level
  });

  const equityCurve: number[] = [];
  const sampleDecisions: string[] = [];
  let ordersPlaced = 0;
  let cycles = 0;

  const totalSteps = Math.min(opts.maxCycles ?? replay.maxCursor, replay.maxCursor);

  // Warm the cursor so the first cycle has lookback history.
  for (let i = 0; i < Math.min(barsLookback, totalSteps); i++) replay.step();

  while (replay.index < totalSteps) {
    // Drive a real cycle through the live trader. `now` is the current bar time so
    // the daily-loss-kill day key advances with the replay timeline.
    const nowMs = (replay.currentBar(symbols[0]!)?.time ?? 0) * 1000;
    const report = await trader.runCycle(nowMs);
    cycles += 1;
    ordersPlaced += report.ordersPlaced;
    equityCurve.push(report.equity);

    if (report.ordersPlaced > 0 && sampleDecisions.length < 6) {
      for (const d of report.decisions) {
        if (d.action === "placed" && sampleDecisions.length < 6) {
          sampleDecisions.push(`cycle ${cycles} @bar ${replay.index}: ${d.symbol} ${d.side} ${d.lots} lots — ${d.reason}`);
        }
      }
    }

    if (!replay.step()) break;
  }

  // Final equity after the last step + any remaining mark-to-market.
  const finalEquity = replay.equityNow();
  equityCurve.push(finalEquity);

  const sharpe = computeNonAnnualizedSharpe(equityCurve);

  const result: RehearsalResult = {
    startingEquity,
    finalEquity,
    totalReturnPct: startingEquity > 0 ? finalEquity / startingEquity - 1 : 0,
    ordersPlaced,
    cycles,
    equityCurve,
    competition: {
      returnPct: computeReturn(finalEquity, startingEquity),
      maxDrawdownPct: computeMaxDrawdown(equityCurve),
      sharpe15m: sharpe.sharpe,
      sharpe15mObs: sharpe.nObs,
    },
    sampleDecisions,
  };

  log(`rehearsal complete: ${cycles} cycles, ${ordersPlaced} orders`);
  return result;
}

// ---------------------------------------------------------------------------
// CLI entry.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const symbols = (process.env.REHEARSAL_SYMBOLS ?? COMPETITION_TRADEABLE.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const maxCycles = process.env.REHEARSAL_MAX_CYCLES ? Number(process.env.REHEARSAL_MAX_CYCLES) : undefined;

  console.log(`\n=== Competition Paper-Mode Rehearsal ===`);
  console.log(`Driving CompetitionLiveTrader.runCycle() over replayed M15 bars (GORDON_LIVE_TRADING=1, ReplayMt5).`);
  console.log(`Symbols: ${symbols.join(", ")}\n`);

  runRehearsal({ symbols, maxCycles })
    .then((r) => {
      console.log(`Live loop ran end-to-end: ${r.ordersPlaced > 0 ? "YES — orders placed against the replay" : "ran, but no orders (signal never fired)"}`);
      console.log(`Cycles run:        ${r.cycles}`);
      console.log(`Orders placed:     ${r.ordersPlaced}`);
      console.log(`Starting equity:   ${r.startingEquity.toFixed(2)}`);
      console.log(`Final equity:      ${r.finalEquity.toFixed(2)}`);
      console.log(`Total return:      ${(r.totalReturnPct * 100).toFixed(3)}%`);
      console.log(`\nCompetition metrics (Section 12):`);
      console.log(`  return:          ${(r.competition.returnPct * 100).toFixed(3)}%`);
      console.log(`  max drawdown:    ${(r.competition.maxDrawdownPct * 100).toFixed(3)}%`);
      console.log(`  15m Sharpe:      ${r.competition.sharpe15m.toFixed(4)} (n=${r.competition.sharpe15mObs})`);
      console.log(`\nSample cycle decisions (placed orders):`);
      if (r.sampleDecisions.length === 0) {
        console.log(`  (none placed)`);
      } else {
        for (const d of r.sampleDecisions) console.log(`  ${d}`);
      }
      console.log("");
    })
    .catch((err) => {
      console.error(`\n✗ rehearsal failed: ${(err as Error).message}\n`);
      console.error((err as Error).stack);
      process.exit(1);
    });
}
