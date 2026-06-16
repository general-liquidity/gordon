#!/usr/bin/env bun
/**
 * PAIRS competition REHEARSAL — drive the dollar-neutral pairs BOOK end-to-end
 * over historical M15 bars, and report the equity-curve quality that decides the
 * §17 Best-Sharpe Award.
 *
 *   bun run scripts/competition/pairs-rehearsal.ts
 *
 * Distinct from `scripts/competition/rehearsal.ts` (which drives the per-symbol
 * `CompetitionLiveTrader` over the TSMOM `SignalFn`). PAIRS is two-leg /
 * cross-instrument, which does NOT fit that per-symbol loop — so this is a
 * pairs-specific driver. It reuses `ReplayMt5` + `loadBars` from rehearsal.ts as
 * the bar-cursor / quote spine, but keeps its own dollar-neutral book accounting
 * on top (a continuously re-balanced spread book, not bracketed single-symbol
 * positions).
 *
 * Each cycle:
 *   1. Advance the replay cursor (one M15 bar).
 *   2. Periodically re-run `selectPairs` over the trailing history (the
 *      cointegration relationship can decay — re-qualify on a schedule).
 *   3. `pairTargets` → the current dollar-neutral per-leg notional for each pair.
 *   4. Mark the book to the bar's closes, charge turnover cost on |Δnotional|,
 *      and roll equity forward.
 *
 * The KEY output is the equity-curve quality: non-annualized per-bar Sharpe
 * (the §12.5 metric on M15 samples), curve smoothness (std of per-bar returns),
 * max drawdown, trade count (must be ≥ 30 for §17 eligibility), and total
 * return. The point is to PROVE a smooth, low-variance, low-DD curve — NOT to
 * claim a return edge.
 */

import { ReplayMt5, loadBars, specFor, type ReplaySymbolData } from "./rehearsal.ts";
import type { Mt5Bar } from "../../src/infra/broker/mt5/bridgeClient.ts";
import {
  selectPairs,
  pairTargets,
  PAIRS_COMPETITION_CONFIG,
  PAIRS_CLUSTERS,
  type SelectedPair,
  type PairTarget,
} from "../../src/infra/trading/competition/pairsCompetitionStrategy.ts";
import {
  computeNonAnnualizedSharpe,
  computeReturn,
  computeMaxDrawdown,
} from "../../src/core/risk-management/competition-scoring.ts";

// ---------------------------------------------------------------------------
// Stats helpers.
// ---------------------------------------------------------------------------

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
};

// ---------------------------------------------------------------------------
// Book state — one signed notional per leg-of-a-pair.
//
// We track each pair's CURRENT signed per-leg notional (positive = long that
// leg). Marking to market: when the price of a leg moves from p0 to p1 while we
// hold `units` of it, the leg PnL is units·(p1 − p0). units = signedNotional /
// entryPrice (notional fixed at the price we sized at). A dollar-neutral pair
// holds +N on one leg and −N on the other, so its directional dollar exposure is
// ~0 and only the SPREAD move drives PnL — the smooth curve we want.
// ---------------------------------------------------------------------------

interface LegPosition {
  /** Signed notional in USD (sign = side). */
  notional: number;
  /** Price the current notional was established at (for units = notional/price). */
  entryPrice: number;
}

interface PairBook {
  key: string;
  symbolA: string;
  symbolB: string;
  legA: LegPosition;
  legB: LegPosition;
}

function pairKey(a: string, b: string): string {
  return `${a}|${b}`;
}

function signedNotional(t: PairTarget, leg: "A" | "B"): number {
  const side = leg === "A" ? t.sideA : t.sideB;
  const notional = leg === "A" ? t.notionalA : t.notionalB;
  if (side === "buy") return notional;
  if (side === "sell") return -notional;
  return 0;
}

// ---------------------------------------------------------------------------
// Rehearsal.
// ---------------------------------------------------------------------------

export interface PairsRehearsalOptions {
  /** Candidate symbols (default: every symbol mentioned in PAIRS_CLUSTERS). */
  symbols?: string[];
  startingEquity?: number;
  /** Re-run pair selection every N cycles (cointegration can decay). */
  reselectEvery?: number;
  /** Warm-up bars before the first decision (selection needs history). */
  warmupBars?: number;
  /** Round-trip cost in bps charged on |Δnotional| per leg (turnover-honest). */
  costBps?: number;
  maxCycles?: number;
  log?: (msg: string) => void;
}

export interface PairsRehearsalResult {
  startingEquity: number;
  finalEquity: number;
  totalReturnPct: number;
  cycles: number;
  /** Number of pair OPEN events (flat → active) — the §17 trade count proxy. */
  tradeCount: number;
  selectedPairs: string[];
  equityCurve: number[];
  /** Per-bar (M15) equity returns — the §12.5 Sharpe input. */
  perBarSharpe: number;
  perBarSharpeObs: number;
  /** Std of per-bar returns — direct curve-smoothness metric (lower = smoother). */
  returnStd: number;
  maxDrawdownPct: number;
  meanBarsActive: number;
}

export async function runPairsRehearsal(opts: PairsRehearsalOptions = {}): Promise<PairsRehearsalResult> {
  const cfg = PAIRS_COMPETITION_CONFIG;
  const universe = opts.symbols ?? Array.from(new Set(PAIRS_CLUSTERS.flat()));
  const startingEquity = opts.startingEquity ?? 1_000_000;
  const reselectEvery = opts.reselectEvery ?? 96; // ~1 trading day of M15 bars
  const warmupBars = opts.warmupBars ?? Math.max(cfg.minObs, 250);
  const costFraction = (opts.costBps ?? cfg.costBps) / 10_000;
  const log = opts.log ?? (() => {});

  // Build the replay spine from the comp M15 bars.
  const replaySymbols: ReplaySymbolData[] = [];
  for (const symbol of universe) {
    let bars: Mt5Bar[];
    try {
      bars = loadBars(symbol);
    } catch {
      continue; // symbol not present in the dataset
    }
    if (bars.length === 0) continue;
    const samplePrice = bars[Math.floor(bars.length / 2)]!.close;
    const { contract, halfSpread } = specFor(symbol, samplePrice);
    replaySymbols.push({ symbol, bars, contractSize: contract.contractSize ?? 1, halfSpread });
  }
  if (replaySymbols.length < 2) {
    throw new Error(`need ≥2 candidate symbols with data; got ${replaySymbols.length}`);
  }
  const presentSymbols = replaySymbols.map((s) => s.symbol);

  const replay = new ReplayMt5({ startingEquity, symbols: replaySymbols });
  const totalSteps = Math.min(opts.maxCycles ?? replay.maxCursor, replay.maxCursor);

  // Warm the cursor so the first decision has selection history.
  for (let i = 0; i < Math.min(warmupBars, totalSteps); i++) replay.step();

  const barsBySymbol = (): Record<string, Mt5Bar[]> => {
    const out: Record<string, Mt5Bar[]> = {};
    for (const s of presentSymbols) {
      const d = (replay as unknown as { data: Map<string, ReplaySymbolData> });
      // Use the public bars() surface (history up to the cursor).
      void d;
    }
    return out;
  };
  void barsBySymbol;

  // History up to the current cursor for every present symbol (via the Mt5Like surface).
  const historyNow = async (): Promise<Record<string, Mt5Bar[]>> => {
    const out: Record<string, Mt5Bar[]> = {};
    for (const s of presentSymbols) {
      out[s] = await replay.bars({ symbol: s });
    }
    return out;
  };

  const book = new Map<string, PairBook>();
  const equityCurve: number[] = [];
  let realizedPlusUnrealized = 0; // cumulative book PnL relative to startingEquity
  let tradeCount = 0;
  let cycles = 0;
  let activeBarSum = 0;

  let selected: SelectedPair[] = [];

  while (replay.index < totalSteps) {
    const hist = await historyNow();

    // (Re)select pairs on the schedule (and on the first cycle).
    if (cycles % reselectEvery === 0) {
      selected = selectPairs(hist, { config: cfg, universe: presentSymbols });
      if (selected.length) {
        log(`cycle ${cycles} @bar ${replay.index}: selected ${selected.map((p) => `${p.symbolA}/${p.symbolB}`).join(", ")}`);
      }
    }

    // Current per-leg targets for the active pairs.
    const equity = startingEquity + realizedPlusUnrealized;
    const targets = pairTargets(hist, selected, equity, { config: cfg });

    // Current prices at this bar.
    const priceOf = (sym: string): number => replay.currentBar(sym)?.close ?? 0;

    let cycleActive = 0;
    let cycleTurnoverCost = 0;

    const seenKeys = new Set<string>();
    for (const t of targets) {
      const key = pairKey(t.symbolA, t.symbolB);
      seenKeys.add(key);
      const pA = priceOf(t.symbolA);
      const pB = priceOf(t.symbolB);
      if (!(pA > 0) || !(pB > 0)) continue;

      const targetA = signedNotional(t, "A");
      const targetB = signedNotional(t, "B");

      let entry = book.get(key);
      const wasActive = entry ? Math.abs(entry.legA.notional) > 1e-9 : false;

      if (!entry) {
        entry = { key, symbolA: t.symbolA, symbolB: t.symbolB, legA: { notional: 0, entryPrice: pA }, legB: { notional: 0, entryPrice: pB } };
        book.set(key, entry);
      }

      // Turnover cost on the change in notional per leg (re-sizing pays too).
      cycleTurnoverCost += Math.abs(targetA - entry.legA.notional) * costFraction;
      cycleTurnoverCost += Math.abs(targetB - entry.legB.notional) * costFraction;

      // Re-establish the position at the current price (notional fixed at this price).
      entry.legA = { notional: targetA, entryPrice: pA };
      entry.legB = { notional: targetB, entryPrice: pB };

      const nowActive = Math.abs(targetA) > 1e-9;
      if (!wasActive && nowActive) tradeCount += 1; // flat → active = one round-trip start
      if (nowActive) cycleActive += 1;
    }
    // Pairs no longer selected → force flat (charge the unwind turnover).
    for (const [key, entry] of book) {
      if (seenKeys.has(key)) continue;
      cycleTurnoverCost += (Math.abs(entry.legA.notional) + Math.abs(entry.legB.notional)) * costFraction;
      entry.legA = { ...entry.legA, notional: 0 };
      entry.legB = { ...entry.legB, notional: 0 };
    }

    activeBarSum += cycleActive;
    realizedPlusUnrealized -= cycleTurnoverCost;

    // Mark-to-market: advance one bar and accrue each held leg's PnL over the move.
    const prevPrices = new Map<string, number>();
    for (const s of presentSymbols) prevPrices.set(s, priceOf(s));

    if (!replay.step()) {
      // Final mark with no further move.
      equityCurve.push(startingEquity + realizedPlusUnrealized);
      cycles += 1;
      break;
    }

    let markPnL = 0;
    for (const entry of book.values()) {
      for (const [sym, leg] of [[entry.symbolA, entry.legA], [entry.symbolB, entry.legB]] as const) {
        if (Math.abs(leg.notional) < 1e-9 || leg.entryPrice <= 0) continue;
        const p1 = priceOf(sym);
        const p0 = prevPrices.get(sym) ?? leg.entryPrice;
        if (!(p1 > 0)) continue;
        const units = leg.notional / leg.entryPrice; // signed units of the instrument
        markPnL += units * (p1 - p0);
      }
    }
    realizedPlusUnrealized += markPnL;
    equityCurve.push(startingEquity + realizedPlusUnrealized);
    cycles += 1;
  }

  const finalEquity = startingEquity + realizedPlusUnrealized;
  const sharpe = computeNonAnnualizedSharpe(equityCurve);

  // Per-bar returns for the smoothness metric (matches the §12.5 Sharpe input).
  const perBarRets: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!;
    if (prev > 0) perBarRets.push((equityCurve[i]! - prev) / prev);
  }

  return {
    startingEquity,
    finalEquity,
    totalReturnPct: startingEquity > 0 ? finalEquity / startingEquity - 1 : 0,
    cycles,
    tradeCount,
    selectedPairs: selected.map((p) => `${p.symbolA}/${p.symbolB}`),
    equityCurve,
    perBarSharpe: sharpe.sharpe,
    perBarSharpeObs: sharpe.nObs,
    returnStd: std(perBarRets),
    maxDrawdownPct: computeMaxDrawdown(equityCurve),
    meanBarsActive: cycles > 0 ? activeBarSum / cycles : 0,
  };
}

// ---------------------------------------------------------------------------
// CLI entry.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const maxCycles = process.env.PAIRS_REHEARSAL_MAX_CYCLES ? Number(process.env.PAIRS_REHEARSAL_MAX_CYCLES) : undefined;

  console.log(`\n=== Competition PAIRS Rehearsal (Best-Sharpe core) ===`);
  console.log(`Dollar-neutral spread book over comp M15 bars (data/momq/bars).`);
  console.log(`Clusters: ${PAIRS_CLUSTERS.map((c) => c.join("/")).join("  |  ")}\n`);

  runPairsRehearsal({ maxCycles, log: (m) => console.log(`  ${m}`) })
    .then((r) => {
      console.log("");
      console.log(`Cycles run:          ${r.cycles}`);
      console.log(`Selected pairs:      ${r.selectedPairs.length ? r.selectedPairs.join(", ") : "(none at finish)"}`);
      console.log(`Mean pairs active:   ${r.meanBarsActive.toFixed(2)} / bar`);
      console.log(`Trade count:         ${r.tradeCount}  ${r.tradeCount >= 30 ? "(≥30 — §17 eligible)" : "(< 30 — §17 INELIGIBLE)"}`);
      console.log(`Starting equity:     ${r.startingEquity.toFixed(2)}`);
      console.log(`Final equity:        ${r.finalEquity.toFixed(2)}`);
      console.log("");
      console.log(`=== Equity-curve quality (Best-Sharpe + Drawdown ranks) ===`);
      console.log(`Total return:        ${(r.totalReturnPct * 100).toFixed(4)}%`);
      console.log(`Per-bar Sharpe:      ${r.perBarSharpe.toFixed(4)}  (non-annualized, n=${r.perBarSharpeObs})`);
      console.log(`Per-bar return std:  ${r.returnStd.toExponential(3)}  (curve smoothness — lower = smoother)`);
      console.log(`Max drawdown:        ${(r.maxDrawdownPct * 100).toFixed(4)}%`);
      console.log("");

      const smooth = r.returnStd < 5e-4; // < 0.05% per-bar return std = very smooth
      const eligible = r.tradeCount >= 30;
      const lowDD = r.maxDrawdownPct < 0.05;
      console.log(`=== VERDICT ===`);
      if (eligible && smooth && lowDD) {
        console.log(`VIABLE Best-Sharpe core: ≥30 trades, smooth low-variance curve (std ${r.returnStd.toExponential(2)}),`);
        console.log(`max DD ${(r.maxDrawdownPct * 100).toFixed(3)}%. Per-bar Sharpe ${r.perBarSharpe.toFixed(3)} — the asset is the SMOOTHNESS,`);
        console.log(`not return alpha. This is a low-DD, dollar-neutral vehicle for the Sharpe + Drawdown ranks.`);
      } else {
        console.log(`Eligibility ≥30 trades: ${eligible ? "YES" : "NO"}; smooth curve: ${smooth ? "YES" : "NO"}; low DD (<5%): ${lowDD ? "YES" : "NO"}.`);
        console.log(`Per-bar Sharpe ${r.perBarSharpe.toFixed(3)}, std ${r.returnStd.toExponential(2)}, DD ${(r.maxDrawdownPct * 100).toFixed(3)}%.`);
        if (!eligible) console.log(`→ Trade count short of the §17 ≥30 floor; widen the universe or raise reselect cadence.`);
      }
      console.log("");
    })
    .catch((err) => {
      console.error(`\n✗ pairs rehearsal failed: ${(err as Error).message}\n`);
      console.error((err as Error).stack);
      process.exit(1);
    });
}
