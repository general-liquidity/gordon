#!/usr/bin/env bun
/**
 * Dollar-neutral RELATIVE-VALUE reversion book — the Best-Sharpe core.
 *
 * The lesson from the TSMOM + scalper rehearsals: a SMOOTH equity curve comes from
 * dollar-NEUTRALITY, not from the signal type. Directional single-leg books (trend or
 * reversion) carry beta that gets hammered on a correlated trending month. The pairs
 * book was smooth precisely because each position is long one leg / short another, so
 * a market move cancels. But the strict cointegration gauntlet only admitted ONE pair
 * on the comp universe → trade-starved (< the §17 30-trade floor).
 *
 * This book keeps the neutrality and gets the breadth: trade the log-ratio z-score of
 * EVERY pair within a correlated cluster (the 5 comp crypto → C(5,2)=10 pairs; XAU/XAG).
 * Highly-correlated assets have a roughly mean-reverting ratio over short windows, so
 * fading the ratio's deviation is a many-small-trades, neutral, smooth book — exactly
 * the Best-Sharpe profile, and the breadth (many pairs) clears the 30-trade floor.
 *
 *   bun run scripts/competition/rehearsals/rv-reversion-rehearsal.ts
 *
 * NOT a return-alpha claim — ratio reversion didn't clear the deflated bar as durable
 * alpha. Its value is the SHAPE: a smooth, low-DD, ≥30-trade dollar-neutral curve, which
 * is what the Best-Sharpe (10%) + Drawdown (15%) ranks + the §17 award reward.
 *
 * Honest scope: comp-month M15 is one correlated down-regime; this is INDICATIVE of
 * curve SHAPE (neutrality holds in any regime), not a return forecast for the live week.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const BARS_DIR = join(process.cwd(), "data", "momq", "bars");
const TF = "M15";

// Correlated clusters — ratio reversion only makes sense WITHIN a cluster.
const CLUSTERS: Record<string, string[]> = {
  crypto: ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BARUSD"],
  metals: ["XAUUSD", "XAGUSD"],
};

const LOOKBACK = 48; // rolling window for the ratio z-score (~12h M15)
const ENTRY_Z = 1.5;
const EXIT_Z = 0.5;
const COST_BPS_PER_SIDE = 5; // crypto bars ship spread=0 → conservative floor
const IS_FRAC = 0.7;

interface RawBar { time: number; close: number }
interface Series { symbol: string; closeByTime: Map<number, number> }

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
}

function loadSeries(symbol: string): Series | null {
  const path = join(BARS_DIR, `${symbol}_${TF}.json`);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as RawBar[];
  const m = new Map<number, number>();
  for (const b of raw) if (Number.isFinite(b.close) && b.close > 0) m.set(b.time, b.close);
  return m.size >= 120 ? { symbol, closeByTime: m } : null;
}

/** Common-timestamp log-ratio series for two symbols: ln(a) − ln(b). */
function logRatio(a: Series, b: Series): { times: number[]; spread: number[] } {
  const times: number[] = [];
  const spread: number[] = [];
  for (const [t, ca] of a.closeByTime) {
    const cb = b.closeByTime.get(t);
    if (cb !== undefined) {
      times.push(t);
      spread.push(Math.log(ca) - Math.log(cb));
    }
  }
  // chronological
  const order = times.map((t, i) => i).sort((x, y) => times[x]! - times[y]!);
  return { times: order.map((i) => times[i]!), spread: order.map((i) => spread[i]!) };
}

interface PairRun {
  pair: string;
  rets: number[]; // per-aligned-bar net return contribution
  trades: number;
  oosStart: number;
}

/** Trade the ratio z-score: fade deviations, dollar-neutral, tight reversion exit. */
function runPair(label: string, spread: number[]): PairRun {
  const n = spread.length;
  const rets = new Array<number>(n).fill(0);
  let pos = 0; // +1 long spread (long a/short b), -1 short spread
  let trades = 0;
  const costFrac = (2 * COST_BPS_PER_SIDE) / 10_000; // both legs per side-change

  for (let i = LOOKBACK + 1; i < n; i++) {
    const w = spread.slice(i - LOOKBACK, i);
    const m = mean(w);
    const sd = stdev(w);
    const prevPos = pos;
    if (sd > 0) {
      const z = (spread[i]! - m) / sd;
      if (pos === 0) {
        if (z > ENTRY_Z) pos = -1; // ratio rich → short spread
        else if (z < -ENTRY_Z) pos = 1; // ratio cheap → long spread
      } else if (pos === 1 && z > -EXIT_Z) pos = 0;
      else if (pos === -1 && z < EXIT_Z) pos = 0;
    }
    // P&L from the position held INTO this bar over the spread change (dollar-neutral).
    const dS = spread[i]! - spread[i - 1]!;
    const cost = Math.abs(pos - prevPos) * costFrac;
    rets[i] = prevPos * dS - cost;
    if (pos !== prevPos) trades++;
  }
  return { pair: label, rets, trades, oosStart: Math.floor(n * IS_FRAC) };
}

const sharpe = (xs: number[]) => {
  const s = stdev(xs);
  return s > 0 ? mean(xs) / s : 0;
};
function maxDD(rets: number[]): number {
  let eq = 1, peak = 1, mdd = 0;
  for (const r of rets) { eq *= 1 + r; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
  return mdd;
}

function main(): void {
  const series = new Map<string, Series>();
  for (const syms of Object.values(CLUSTERS)) {
    for (const s of syms) {
      const ser = loadSeries(s);
      if (ser) series.set(s, ser);
    }
  }

  // All within-cluster pairs.
  const pairs: Array<[string, string]> = [];
  for (const syms of Object.values(CLUSTERS)) {
    const present = syms.filter((s) => series.has(s));
    for (let i = 0; i < present.length; i++)
      for (let j = i + 1; j < present.length; j++) pairs.push([present[i]!, present[j]!]);
  }

  console.log("=".repeat(78));
  console.log("DOLLAR-NEUTRAL RELATIVE-VALUE REVERSION — Best-Sharpe core (comp M15)");
  console.log("=".repeat(78));
  console.log(`Clusters     : ${Object.entries(CLUSTERS).map(([k, v]) => `${k}(${v.length})`).join(", ")}`);
  console.log(`Pairs traded : ${pairs.length} (${pairs.map((p) => `${p[0].replace("USD", "")}/${p[1].replace("USD", "")}`).join(", ")})`);
  console.log(`z-score      : lookback ${LOOKBACK}, entry ±${ENTRY_Z}, exit ±${EXIT_Z}, cost ${COST_BPS_PER_SIDE}bps/side`);
  console.log("");

  const runs = pairs.map(([a, b]) => {
    const { spread } = logRatio(series.get(a)!, series.get(b)!);
    return runPair(`${a}/${b}`, spread);
  }).filter((r) => r.rets.length > LOOKBACK + 10);

  // Equal-weight portfolio: average the per-bar return across active pairs, by index
  // from each pair's own OOS start (align on the back 30% of each pair's series).
  let totalTrades = 0;
  const perPair: string[] = [];
  for (const r of runs) {
    const oos = r.rets.slice(r.oosStart);
    const isr = r.rets.slice(0, r.oosStart);
    totalTrades += r.trades;
    perPair.push(`  ${r.pair.padEnd(16)} trades ${String(r.trades).padStart(4)}  IS Sh ${sharpe(isr).toFixed(3).padStart(7)}  OOS Sh ${sharpe(oos).toFixed(3).padStart(7)}  OOS ret ${(oos.reduce((s, v) => s + v, 0) * 100).toFixed(2).padStart(7)}%`);
  }

  // Portfolio curve = equal-weight mean across pairs at each bar (1/nPairs per pair).
  const maxLen = Math.max(...runs.map((r) => r.rets.length));
  const port: number[] = [];
  for (let i = 0; i < maxLen; i++) {
    let sum = 0, cnt = 0;
    for (const r of runs) { if (i < r.rets.length) { sum += r.rets[i]!; cnt++; } }
    if (cnt > 0) port.push(sum / cnt); // equal-weight, dollar-neutral basket
  }
  const oosStart = Math.floor(port.length * IS_FRAC);
  const oosPort = port.slice(oosStart);

  console.log("PER-PAIR (IS/OOS):");
  for (const line of perPair) console.log(line);
  console.log("");

  console.log("=".repeat(78));
  console.log("PORTFOLIO (equal-weight dollar-neutral basket) — Best-Sharpe metrics");
  console.log("=".repeat(78));
  const stdBar = stdev(oosPort);
  console.log(`Total trades (all pairs)  : ${totalTrades}  (§17 ≥30 floor: ${totalTrades >= 30 ? "YES — ELIGIBLE" : "NO"})`);
  console.log(`OOS per-bar Sharpe        : ${sharpe(oosPort).toFixed(4)}  (n=${oosPort.length})`);
  console.log(`OOS per-bar return std    : ${stdBar.toExponential(2)}  (curve smoothness — lower = smoother)`);
  console.log(`OOS max drawdown          : ${(maxDD(oosPort) * 100).toFixed(3)}%`);
  console.log(`OOS total return          : ${(oosPort.reduce((s, v) => s + v, 0) * 100).toFixed(3)}%`);
  console.log(`Breadth lift (book vs mean pair OOS Sharpe): ${sharpe(oosPort).toFixed(3)} vs ${mean(runs.map((r) => sharpe(r.rets.slice(r.oosStart)))).toFixed(3)}`);
  console.log("");
  const smooth = stdBar < 1e-3;
  const lowDD = Math.abs(maxDD(oosPort)) < 0.05;
  console.log("=".repeat(78));
  console.log("VERDICT");
  console.log("=".repeat(78));
  console.log(`≥30 trades: ${totalTrades >= 30 ? "YES" : "NO"} | smooth curve: ${smooth ? "YES" : "NO"} | low DD (<5%): ${lowDD ? "YES" : "NO"}`);
  console.log(`→ ${totalTrades >= 30 && smooth && lowDD ? "Viable Best-Sharpe core: neutral + smooth + trade-eligible." : "Not all criteria met — see metrics above."}`);
  console.log("");
}

main();
