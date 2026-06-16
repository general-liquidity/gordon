#!/usr/bin/env bun
/**
 * Fetch full-month M15 OHLC for the competition's 5 crypto (absent from the
 * Syphonix backtest parquet) from public Binance klines — READ-ONLY market data,
 * no auth, no orders. Writes data/momq/bars/<SYM>_M15.json in the same shape as
 * the FX/metals resampler output so the analysis + dry-run consume them uniformly.
 *
 *   bun run scripts/dev/fetch-crypto-history.ts                 # default window = parquet window
 *   bun run scripts/dev/fetch-crypto-history.ts 2026-05-11 2026-06-10
 *
 * Comp ticker → Binance pair (USDT ≈ USD here). BARUSD = HBAR (Hedera) per the
 * organizers' Discord clarification.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PAIRS: Record<string, string> = {
  BTCUSD: "BTCUSDT",
  ETHUSD: "ETHUSDT",
  SOLUSD: "SOLUSDT",
  XRPUSD: "XRPUSDT",
  BARUSD: "HBARUSDT",
};

const OUT = "data/momq/bars";
const INTERVAL = "15m";
const TAG = "M15";

const fromArg = process.argv[2] ?? "2026-05-11";
const toArg = process.argv[3] ?? "2026-06-10";
const fromMs = Date.parse(`${fromArg}T00:00:00Z`);
const toMs = Date.parse(`${toArg}T23:59:59Z`);

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
  spread: number;
  realVolume: number;
}

async function fetchSymbol(pair: string): Promise<Bar[]> {
  const bars: Bar[] = [];
  let start = fromMs;
  while (start < toMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${INTERVAL}&startTime=${start}&endTime=${toMs}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${pair}: HTTP ${res.status} ${await res.text()}`);
    const rows = (await res.json()) as unknown[][];
    if (!rows.length) break;
    for (const k of rows) {
      bars.push({
        time: Math.floor((k[0] as number) / 1000), // open time, epoch seconds
        open: parseFloat(k[1] as string),
        high: parseFloat(k[2] as string),
        low: parseFloat(k[3] as string),
        close: parseFloat(k[4] as string),
        tickVolume: k[8] as number, // number of trades
        spread: 0,
        realVolume: parseFloat(k[5] as string),
      });
    }
    const lastClose = rows[rows.length - 1]![6] as number; // close time ms
    if (rows.length < 1000) break;
    start = lastClose + 1;
  }
  return bars;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  console.log(`\n── fetch crypto M15 (${fromArg} … ${toArg}) ──\n`);
  for (const [sym, pair] of Object.entries(PAIRS)) {
    try {
      const bars = await fetchSymbol(pair);
      writeFileSync(join(OUT, `${sym}_${TAG}.json`), JSON.stringify(bars));
      const span =
        bars.length > 0
          ? `${new Date(bars[0]!.time * 1000).toISOString().slice(0, 10)}…${new Date(bars[bars.length - 1]!.time * 1000).toISOString().slice(0, 10)}`
          : "—";
      console.log(`  ${sym.padEnd(8)} ${pair.padEnd(9)} ${String(bars.length).padStart(5)} bars  ${span}`);
    } catch (e) {
      console.log(`  ${sym.padEnd(8)} ✗ ${(e as Error).message}`);
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
