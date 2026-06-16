#!/usr/bin/env bun
/**
 * Path-risk Monte Carlo over the Best-Sharpe core — "can it survive the 5th-percentile path?"
 *
 * Recomputes the dollar-neutral relative-value reversion book's per-bar returns on the comp
 * universe (the same construction as rv-reversion-rehearsal), then runs 10,000 resampled paths
 * under three resamplers (IID / stationary-block / GARCH) and reports the tail: the 5th-pct
 * return and the 95th/99th-pct drawdown. The block + GARCH methods preserve volatility
 * clustering, so their tails are the realistic ones — the numbers that decide "trade it or not".
 *
 *   bun run scripts/competition/path-risk.ts
 *
 * Honest scope: the input is ONE month of comp M15 returns; the MC explores the PATH space of
 * that return distribution (the right tool for "bad-streak survival"), not regime change beyond it.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathRiskComparison, type PathRiskResult } from "../../src/infra/trading/quant/pathRiskMonteCarlo.ts";

const BARS_DIR = join(process.cwd(), "data", "momq", "bars");
const TF = "M15";
const CLUSTERS = [
  ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BARUSD"],
  ["XAUUSD", "XAGUSD"],
];
const LOOKBACK = 48, ENTRY_Z = 1.5, EXIT_Z = 0.5, COST_BPS = 5;

interface RawBar { time: number; close: number }
const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
const std = (xs: number[]) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1)); };

function closeByTime(symbol: string): Map<number, number> | null {
  const p = join(BARS_DIR, `${symbol}_${TF}.json`);
  if (!existsSync(p)) return null;
  const raw = JSON.parse(readFileSync(p, "utf8")) as RawBar[];
  const m = new Map<number, number>();
  for (const b of raw) if (Number.isFinite(b.close) && b.close > 0) m.set(b.time, b.close);
  return m.size >= 120 ? m : null;
}

/** Per-bar net return of the dollar-neutral ratio-reversion book (equal-weight basket). */
function bookReturns(): number[] {
  const series = new Map<string, Map<number, number>>();
  for (const cl of CLUSTERS) for (const s of cl) { const m = closeByTime(s); if (m) series.set(s, m); }
  const pairs: Array<[string, string]> = [];
  for (const cl of CLUSTERS) { const p = cl.filter((s) => series.has(s)); for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) pairs.push([p[i]!, p[j]!]); }

  const costFrac = (2 * COST_BPS) / 10_000;
  const perPair: number[][] = [];
  for (const [a, b] of pairs) {
    const ma = series.get(a)!, mb = series.get(b)!;
    const times = [...ma.keys()].filter((t) => mb.has(t)).sort((x, y) => x - y);
    const spread = times.map((t) => Math.log(ma.get(t)!) - Math.log(mb.get(t)!));
    const rets = new Array<number>(spread.length).fill(0);
    let pos = 0;
    for (let i = LOOKBACK + 1; i < spread.length; i++) {
      const w = spread.slice(i - LOOKBACK, i), m = mean(w), sd = std(w), prev = pos;
      if (sd > 0) { const z = (spread[i]! - m) / sd;
        if (pos === 0) { if (z > ENTRY_Z) pos = -1; else if (z < -ENTRY_Z) pos = 1; }
        else if (pos === 1 && z > -EXIT_Z) pos = 0; else if (pos === -1 && z < EXIT_Z) pos = 0; }
      rets[i] = prev * (spread[i]! - spread[i - 1]!) - Math.abs(pos - prev) * costFrac;
    }
    perPair.push(rets);
  }
  // Equal-weight basket per bar.
  const maxLen = Math.max(...perPair.map((r) => r.length));
  const book: number[] = [];
  for (let i = 0; i < maxLen; i++) { let s = 0, c = 0; for (const r of perPair) if (i < r.length) { s += r[i]!; c++; } if (c) book.push(s / c); }
  return book;
}

function row(r: PathRiskResult): string {
  return [
    r.method.padEnd(11),
    `${(r.returnP5 * 100).toFixed(2)}%`.padStart(9),
    `${(r.returnP50 * 100).toFixed(2)}%`.padStart(9),
    `${(r.drawdownP95 * 100).toFixed(2)}%`.padStart(9),
    `${(r.drawdownP99 * 100).toFixed(2)}%`.padStart(9),
    `${(r.drawdownWorst * 100).toFixed(2)}%`.padStart(9),
    `${(r.probRuin * 100).toFixed(1)}%`.padStart(8),
  ].join(" ");
}

function main(): void {
  const rets = bookReturns();
  console.log("=".repeat(86));
  console.log("PATH-RISK MONTE CARLO — Best-Sharpe core (dollar-neutral RV reversion), 10,000 paths");
  console.log("=".repeat(86));
  console.log(`Input: ${rets.length} per-bar returns | per-bar std ${std(rets).toExponential(2)} | one backtest total ${((rets.reduce((s, v) => s + v, 0)) * 100).toFixed(2)}%`);
  console.log(`Resamplers: iid (optimistic baseline) → stationary block (preserves clustering) → garch (fat tails)`);
  console.log("");
  console.log(["method".padEnd(11), "ret p5".padStart(9), "ret p50".padStart(9), "DD p95".padStart(9), "DD p99".padStart(9), "DD worst".padStart(9), "P(>20%)".padStart(8)].join(" "));
  console.log("-".repeat(86));

  const cmp = pathRiskComparison(rets, { nPaths: 10_000, ruinDrawdown: 0.2, seed: 12345 });
  for (const m of ["iid", "stationary", "garch"] as const) console.log(row(cmp[m]));
  console.log("");

  // The decision number: the realistic (block/garch) bad-path drawdown + ruin prob.
  const realisticDD = Math.max(cmp.stationary.drawdownP95, cmp.garch.drawdownP95);
  const realisticRuin = Math.max(cmp.stationary.probRuin, cmp.garch.probRuin);
  const iidDD = cmp.iid.drawdownP95;
  console.log("=".repeat(86));
  console.log("VERDICT — survive the 5th-percentile path?");
  console.log("=".repeat(86));
  console.log(`IID (naive) 95th-pct DD     : ${(iidDD * 100).toFixed(2)}%  ← the optimistic number a vanilla MC would report`);
  console.log(`REALISTIC 95th-pct DD       : ${(realisticDD * 100).toFixed(2)}%  ← block/GARCH, clustering preserved (trust this)`);
  console.log(`Tail widening from clustering: ${(iidDD > 0 ? realisticDD / iidDD : 1).toFixed(2)}×`);
  console.log(`P(drawdown > 20%) realistic : ${(realisticRuin * 100).toFixed(1)}%`);
  console.log("");
  const survives = realisticDD < 0.15 && realisticRuin < 0.05;
  console.log(`→ ${survives ? "SURVIVES: even the bad path keeps DD well inside the red-line — deploy the core." : "CAUTION: the bad-path drawdown is material — size down or widen breadth before committing."}`);
  console.log(`  (Dollar-neutral construction is why the tail is contained — there's no directional beta to blow out.)`);
  console.log("");
}

main();
