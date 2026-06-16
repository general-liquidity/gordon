/**
 * Fetch Binance public perpetual funding-rate history for the 5 competition crypto.
 *
 * Read-only public data (no auth, no orders). Endpoint:
 *   https://fapi.binance.com/fapi/v1/fundingRate?symbol=<PAIR>&startTime=<ms>&endTime=<ms>&limit=1000
 * Funding posts every 8h. We paginate forward across the parquet window.
 *
 * Window: 2026-05-11 … 2026-06-10 (the M15 parquet window). We fetch a small
 * pad before the start so the first rebalance day has a funding observation.
 *
 * Output: data/momq/funding/<SYM>_funding.json — array of
 *   { time: epoch-sec, fundingRate: number }, ascending by time.
 * Pair → competition symbol map: BTCUSDT→BTCUSD, ETHUSDT→ETHUSD,
 *   SOLUSDT→SOLUSD, XRPUSDT→XRPUSD, HBARUSDT→BARUSD.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FAPI = "https://fapi.binance.com/fapi/v1/fundingRate";

// comp-symbol ← Binance pair
const PAIRS: { pair: string; sym: string }[] = [
  { pair: "BTCUSDT", sym: "BTCUSD" },
  { pair: "ETHUSDT", sym: "ETHUSD" },
  { pair: "SOLUSDT", sym: "SOLUSD" },
  { pair: "XRPUSDT", sym: "XRPUSD" },
  { pair: "HBARUSDT", sym: "BARUSD" },
];

// Pad 2 days before the window start so the first rebalance has prior funding.
const START_MS = Date.UTC(2026, 4, 9, 0, 0, 0); // 2026-05-09
const END_MS = Date.UTC(2026, 5, 10, 23, 59, 59); // 2026-06-10

interface BinanceFundingRow {
  symbol: string;
  fundingTime: number; // ms
  fundingRate: string;
  markPrice?: string;
}

interface FundingPoint {
  time: number; // epoch-sec
  fundingRate: number;
}

async function fetchPair(pair: string): Promise<FundingPoint[]> {
  const out: FundingPoint[] = [];
  let cursor = START_MS;
  // Funding is every 8h → ~3/day → ~93 over the window. limit=1000 covers it in
  // one page, but paginate defensively in case Binance caps the range.
  for (let guard = 0; guard < 20; guard++) {
    const url = `${FAPI}?symbol=${pair}&startTime=${cursor}&endTime=${END_MS}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`${pair}: HTTP ${res.status} ${res.statusText} — ${await res.text()}`);
    }
    const rows = (await res.json()) as BinanceFundingRow[];
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      out.push({ time: Math.floor(r.fundingTime / 1000), fundingRate: Number(r.fundingRate) });
    }
    const lastTime = rows[rows.length - 1]!.fundingTime;
    if (rows.length < 1000 || lastTime >= END_MS) break;
    cursor = lastTime + 1;
  }
  // Dedup by time (pagination overlap) + sort ascending.
  const byTime = new Map<number, FundingPoint>();
  for (const p of out) byTime.set(p.time, p);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

async function main(): Promise<void> {
  const outDir = join("data", "momq", "funding");
  await mkdir(outDir, { recursive: true });

  console.log(`Fetching Binance funding-rate history (${PAIRS.length} pairs)`);
  console.log(`Window: ${new Date(START_MS).toISOString()} … ${new Date(END_MS).toISOString()}\n`);

  let anyFailed = false;
  for (const { pair, sym } of PAIRS) {
    try {
      const points = await fetchPair(pair);
      const file = join(outDir, `${sym}_funding.json`);
      await writeFile(file, JSON.stringify(points, null, 2));
      const first = points[0];
      const last = points[points.length - 1];
      const span = first && last
        ? `${new Date(first.time * 1000).toISOString().slice(0, 16)} … ${new Date(last.time * 1000).toISOString().slice(0, 16)}`
        : "(empty)";
      console.log(`  ${pair.padEnd(9)} → ${sym.padEnd(7)} ${String(points.length).padStart(4)} points  ${span}`);
    } catch (err) {
      anyFailed = true;
      console.error(`  ${pair.padEnd(9)} → ${sym.padEnd(7)} FAILED: ${(err as Error).message}`);
    }
  }

  if (anyFailed) {
    console.error("\nSome pairs failed (network/region block). The validation script can run once data exists.");
    process.exit(1);
  }
  console.log("\nDone. Funding JSONs written to data/momq/funding/");
}

void main();
