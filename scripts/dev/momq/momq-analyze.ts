#!/usr/bin/env bun
/**
 * Quick coverage + cross-sectional snapshot of the pulled Model to Market data.
 * Reads data/momq (catalog + bars) and reports, per instrument: bar count, span,
 * window return, annualized vol (from 15-min returns), and trend cleanliness
 * (Kaufman efficiency ratio) — then runs the universe-wide breadth classifier.
 *
 *   bun run scripts/dev/momq/momq-analyze.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { classifyMarketBreadth } from "../../../src/core/alpha/market-breadth-bias.ts";

const DIR = "data/momq";
const M15_PER_YEAR = 24 * 4 * 365;

interface Bar { time: number; close: number }

function stats(bars: Bar[]) {
  const c = bars.map((b) => b.close);
  const rets: number[] = [];
  for (let i = 1; i < c.length; i++) rets.push(c[i]! / c[i - 1]! - 1);
  const mean = rets.reduce((s, v) => s + v, 0) / (rets.length || 1);
  const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / (rets.length || 1);
  const vol = Math.sqrt(variance) * Math.sqrt(M15_PER_YEAR);
  const totalRet = c.length > 1 ? c[c.length - 1]! / c[0]! - 1 : 0;
  const net = Math.abs(c[c.length - 1]! - c[0]!);
  let path = 0;
  for (let i = 1; i < c.length; i++) path += Math.abs(c[i]! - c[i - 1]!);
  const er = path > 0 ? net / path : 0; // efficiency ratio = trend cleanliness
  return { n: bars.length, totalRet, vol, er };
}

const files = readdirSync(join(DIR, "bars")).filter((f) => f.endsWith(".json"));
const rows = files.map((f) => {
  const sym = f.replace(/_M15\.json$/, "");
  const bars = JSON.parse(readFileSync(join(DIR, "bars", f), "utf8")) as Bar[];
  return { sym, ...stats(bars) };
});

rows.sort((a, b) => b.vol - a.vol);

console.log("\n── Model to Market universe snapshot (M15) ──\n");
console.log("symbol        bars   return%   annVol%   trendER");
for (const r of rows) {
  console.log(
    `${r.sym.padEnd(12)} ${String(r.n).padStart(5)}  ${(r.totalRet * 100).toFixed(2).padStart(7)}  ${(r.vol * 100).toFixed(1).padStart(7)}  ${r.er.toFixed(2).padStart(6)}`,
  );
}

const breadth = classifyMarketBreadth({
  symbols: rows.map((r) => ({ symbol: r.sym, return: r.totalRet, trendCleanliness: r.er })),
});
console.log("\n── cross-sectional breadth ──");
console.log(breadth?.summary ?? "n/a");
console.log(
  `direction=${breadth?.direction} strategy=${breadth?.strategy} conviction=${breadth?.conviction?.toFixed(2)} favored=[${breadth?.favored.join(", ")}]\n`,
);
