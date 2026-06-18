/**
 * ISOLATED-EXPERIMENT harness — the disciplined alternative to "throw everything / ensemble".
 *
 * Runs a SMALL, PRE-REGISTERED set of mechanism-distinct hypotheses, each in ISOLATION (its own
 * pooled book over the universe, ONE pre-registered config — no intra-strategy grid selection),
 * scored on the EXACT §12.5 competition metric (non-annualized 15-min Sharpe) on a held-out OOS
 * half, and **deflated by the number of experiments** (`deflatedSharpeRatio` over N trials) so the
 * multiple-testing bar rises with the count — we cannot cherry-pick a winner out of noise.
 *
 * This is NOT a sweep. Each row is reported straight; nothing is combined or selected. The point is
 * an honest read on whether ANY single mechanism clears the deflated bar after cost — and the same
 * harness re-points at LIVE/paper data (swap ALPHA_BARS_DIR) to test the one variable our historical
 * backtests never could: the live venue's cost/microstructure.
 *
 *   bun run scripts/research/searches/isolated-experiments.ts                       # 1-month comp data
 *   ALPHA_BARS_DIR=data/momq/crypto-extended bun run scripts/research/searches/isolated-experiments.ts   # 18-mo crypto
 *   SPREAD_BPS=5 bun run ...                                                          # stress the taker cost
 *
 * Each `EXPERIMENTS` id resolves to a registry factory; the config is `paramGrid[0]` (pre-registered
 * default). The RV-reversion CORE is the separately-validated incumbent (see best-sharpe-sweep:
 * ~2.4% DD, ~0 OOS Sharpe) — the question here is whether any isolated DIRECTIONAL mechanism beats
 * that ~0 incumbent once cost + multiple-testing are honestly applied.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runCompetitionDryRun, type SignalFn } from "../../../src/backtest/competition-dry-run.ts";
import { deflatedSharpeRatio, probabilisticSharpeRatio } from "../../../src/infra/trading/ops/backtestCredibility.ts";
import { STRATEGY_REGISTRY, type ResearchBar } from "./strategy-registry.ts";
import { COMPETITION_TRADEABLE } from "../../../src/infra/trading/competition/competitionStrategy.ts";

const BARS_DIR = join(process.cwd(), process.env.ALPHA_BARS_DIR ?? join("data", "momq", "bars"));
const TF = process.env.ALPHA_TF ?? "M15";
const SPREAD_BPS = (() => { const n = Number(process.env.SPREAD_BPS ?? "2"); return Number.isFinite(n) && n >= 0 ? n : 2; })();
const VOL_WINDOW = 96;
const BARS_PER_DAY = TF.toUpperCase() === "M15" ? 96 : TF.toUpperCase() === "1H" || TF.toUpperCase() === "H1" ? 24 : 1;
const PERIODS_PER_YEAR = BARS_PER_DAY * 365;
const IS_FRAC = 0.5; // first half = in-sample; back half = held-out OOS (scored)

/** Pre-registered, mechanism-distinct hypotheses (one per family). NOT a grid. Edit deliberately. */
const EXPERIMENTS = [
  "rsi_meanrev",          // mean-reversion: oscillator extremes
  "roc_momentum",         // momentum: rate-of-change continuation
  "donchian_breakout",    // breakout: channel break
  "supertrend_follow",    // trend: ATR trend-follow
  "alpha_reversal",       // reversal: the reversal-strategy primitive
  "alpha_regime_adaptive",// adaptive: regime-switching
];

interface RawBar { time: number; open?: number; high?: number; low?: number; close: number }

function loadSymbol(symbol: string): ResearchBar[] | null {
  const path = join(BARS_DIR, `${symbol}_${TF}.json`);
  if (!existsSync(path)) return null;
  let raw: RawBar[];
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as RawBar[];
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length < VOL_WINDOW + 10) return null;
  const closes = raw.map((b) => b.close);
  const out: ResearchBar[] = [];
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i]!;
    // Rolling annualized vol from consecutive-close returns over the trailing window.
    const start = Math.max(1, i - VOL_WINDOW + 1);
    const rets: number[] = [];
    for (let j = start; j <= i; j++) { const p = closes[j - 1]!; if (p > 0) rets.push(closes[j]! / p - 1); }
    let volAnnual = 0;
    if (rets.length >= 2) {
      const m = rets.reduce((a, c) => a + c, 0) / rets.length;
      volAnnual = Math.sqrt(rets.reduce((a, c) => a + (c - m) ** 2, 0) / rets.length) * Math.sqrt(PERIODS_PER_YEAR);
    }
    out.push({
      // The dry-run treats `time` as ms epoch for day-boundary (daily-loss-kill) detection; our
      // bar files store seconds → convert, else the whole run reads as one day and an early loss
      // halts the strategy for the entire span (the 18-month 0-trades bug).
      symbol, time: b.time < 1e12 ? b.time * 1000 : b.time, close: b.close, volAnnual,
      open: b.open ?? b.close, high: b.high ?? b.close, low: b.low ?? b.close,
    });
  }
  return out;
}

/** Interleave the universe's bars chronologically (the dry-run routes per-symbol history). */
function loadUniverse(): { bars: ResearchBar[]; symbols: string[] } {
  const want = (process.env.SYMBOLS ?? COMPETITION_TRADEABLE.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const all: ResearchBar[] = [];
  const symbols: string[] = [];
  for (const s of want) {
    const bars = loadSymbol(s);
    if (bars) { all.push(...bars); symbols.push(s); }
  }
  all.sort((a, b) => a.time - b.time);
  return { bars: all, symbols };
}

function nonAnnualizedSharpe(rets: number[]): number {
  if (rets.length < 2) return 0;
  const m = rets.reduce((a, c) => a + c, 0) / rets.length;
  const v = rets.reduce((a, c) => a + (c - m) ** 2, 0) / rets.length;
  return v > 0 ? m / Math.sqrt(v) : 0;
}

function maxDrawdownFromReturns(rets: number[]): number {
  let eq = 1, peak = 1, mdd = 0;
  for (const r of rets) { eq *= 1 + r; if (eq > peak) peak = eq; const dd = (peak - eq) / peak; if (dd > mdd) mdd = dd; }
  return mdd;
}

interface Result {
  id: string; family: string; oosSharpe15m: number; oosReturnPct: number; oosMaxDd: number;
  oosTrades: number; psr: number; dsr: number; dsrSignificant: boolean;
}

function scoreExperiment(id: string, signal: SignalFn, bars: ResearchBar[], nTrials: number): Result {
  const factory = STRATEGY_REGISTRY.find((f) => f.id === id)!;
  const report = runCompetitionDryRun({
    bars, signal, startingEquity: 1_000_000, execution: "taker",
    costs: { spreadBps: SPREAD_BPS }, periodsPerYear: PERIODS_PER_YEAR, maxSignalHistory: 768,
  });
  const eq = report.equityCurve;
  const barReturns: number[] = [];
  for (let i = 1; i < eq.length; i++) { const p = eq[i - 1]!.equity; if (p > 0) barReturns.push(eq[i]!.equity / p - 1); }
  const isEnd = Math.floor(barReturns.length * IS_FRAC);
  const oos = barReturns.slice(isEnd);
  const oosCutTime = eq[Math.min(eq.length - 1, isEnd + 1)]?.timestamp ?? 0;
  const oosTrades = report.trades.filter((t) => t.exitTime >= oosCutTime).length;
  const psr = probabilisticSharpeRatio(oos, 0);
  const dsr = deflatedSharpeRatio(oos, nTrials, PERIODS_PER_YEAR);
  return {
    id, family: factory.family,
    oosSharpe15m: nonAnnualizedSharpe(oos),
    oosReturnPct: (oos.reduce((a, r) => a * (1 + r), 1) - 1) * 100,
    oosMaxDd: maxDrawdownFromReturns(oos) * 100,
    oosTrades,
    psr: psr.psr,
    dsr: dsr.dsr,
    dsrSignificant: dsr.significant,
  };
}

function main(): void {
  const { bars, symbols } = loadUniverse();
  console.log("=".repeat(96));
  console.log("ISOLATED PRE-REGISTERED EXPERIMENTS — each mechanism alone, §12.5 OOS, deflated by N");
  console.log("=".repeat(96));
  console.log(`data: ${BARS_DIR} (${TF}) · symbols: ${symbols.length} [${symbols.join(", ")}] · bars: ${bars.length}`);
  console.log(`cost: taker, spread ${SPREAD_BPS}bps/side · OOS = back ${((1 - IS_FRAC) * 100).toFixed(0)}% · N experiments: ${EXPERIMENTS.length} (deflation trials)`);
  if (bars.length === 0) { console.error("\n✗ no bars loaded — check ALPHA_BARS_DIR / SYMBOLS / ALPHA_TF.\n"); process.exit(1); }
  console.log("");
  console.log("id                      family          OOS Sh15m   OOS ret    OOS DD   trades   PSR     DSR    verdict");
  console.log("─".repeat(96));

  const results: Result[] = [];
  for (const id of EXPERIMENTS) {
    const factory = STRATEGY_REGISTRY.find((f) => f.id === id);
    if (!factory) { console.log(`${id.padEnd(23)} (not found in registry — skipped)`); continue; }
    const signal = factory.build(factory.paramGrid[0] ?? {});
    const r = scoreExperiment(id, signal, bars, EXPERIMENTS.length);
    results.push(r);
    // ACTIVE = made enough trades to be a real test (else its config simply didn't fire → not a null).
    // PASS = active AND positive OOS Sharpe AND deflated-Sharpe (corrected for N trials) significant.
    const active = r.oosTrades >= 10;
    const pass = active && r.oosSharpe15m > 0 && r.dsrSignificant;
    const verdict = pass ? "✅ PASS" : active ? "—" : "inactive";
    console.log(
      `${r.id.padEnd(23)} ${r.family.padEnd(15)} ${(r.oosSharpe15m >= 0 ? "+" : "") + r.oosSharpe15m.toFixed(4)}   ` +
      `${(r.oosReturnPct >= 0 ? "+" : "") + r.oosReturnPct.toFixed(2)}%   ${r.oosMaxDd.toFixed(2)}%   ${String(r.oosTrades).padStart(5)}   ` +
      `${r.psr.toFixed(2)}   ${r.dsr.toFixed(2)}   ${verdict}`,
    );
  }

  const activeResults = results.filter((r) => r.oosTrades >= 10);
  const inactive = results.filter((r) => r.oosTrades < 10);
  const survivors = activeResults.filter((r) => r.oosSharpe15m > 0 && r.dsrSignificant);
  console.log("");
  console.log(`Reference incumbent: RV-reversion core (separately validated, best-sharpe-sweep) — ~2.4% DD, ~0 OOS Sharpe.`);
  if (inactive.length) console.log(`Inactive (config did not fire on this data, NOT a tested null): ${inactive.map((r) => r.id).join(", ")}.`);
  console.log(
    survivors.length === 0
      ? `\n→ 0/${activeResults.length} ACTIVE isolated mechanisms clear the deflated bar (DSR-significant + positive OOS) after ${SPREAD_BPS}bps cost.\n` +
        `  Consistent with the session-long null: no single directional mechanism shows durable edge on this data.\n` +
        `  The honest use is to RE-RUN this against LIVE/paper data (swap ALPHA_BARS_DIR) — the one untested variable.`
      : `\n→ ${survivors.length}/${activeResults.length} active cleared the deflated bar: ${survivors.map((s) => s.id).join(", ")}.\n` +
        `  TREAT AS A LEAD, NOT A GREEN LIGHT — confirm on a second data span + the live cost model before sizing.`,
  );
}

main();
