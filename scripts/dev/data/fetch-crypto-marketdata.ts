/**
 * Fetch CoinGecko free public historical daily market data for the 5 competition
 * crypto over the M15 parquet window (2026-05-11 … 2026-06-10).
 *
 * Read-only public data (no API key). Endpoint:
 *   https://api.coingecko.com/api/v3/coins/<id>/market_chart/range
 *     ?vs_currency=usd&from=<sec>&to=<sec>
 * returns { prices, market_caps, total_volumes } — each an array of [ms, value].
 * At a >1-day range CoinGecko auto-buckets to DAILY granularity.
 *
 * Window: pad 2 days before the start so the first daily rebalance has a
 * market-cap / volume observation at-or-before it.
 *
 * Output: data/momq/marketdata/<SYM>.json — array of
 *   { time: epoch-sec, marketCap: number, volume: number }, ascending by time.
 * CoinGecko id → competition symbol:
 *   bitcoin→BTCUSD, ethereum→ETHUSD, solana→SOLUSD, ripple→XRPUSD,
 *   hedera-hashgraph→BARUSD (HBAR).
 *
 * Rate limit: CoinGecko's free public tier is ~5-15 calls/min and 429s under
 * load — we sleep ~3s between symbols and retry 429/5xx with exponential backoff.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = "https://api.coingecko.com/api/v3/coins";

// comp-symbol ← CoinGecko id
const COINS: { id: string; sym: string }[] = [
  { id: "bitcoin", sym: "BTCUSD" },
  { id: "ethereum", sym: "ETHUSD" },
  { id: "solana", sym: "SOLUSD" },
  { id: "ripple", sym: "XRPUSD" },
  { id: "hedera-hashgraph", sym: "BARUSD" },
];

// Pad 2 days before the window start so the first daily rebalance has a prior obs.
const FROM_SEC = Math.floor(Date.UTC(2026, 4, 9, 0, 0, 0) / 1000); // 2026-05-09
const TO_SEC = Math.floor(Date.UTC(2026, 5, 10, 23, 59, 59) / 1000); // 2026-06-10

interface MarketChartRange {
  prices: [number, number][];
  market_caps: [number, number][];
  total_volumes: [number, number][];
}

interface MarketPoint {
  time: number; // epoch-sec
  marketCap: number;
  volume: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET with 429/5xx exponential backoff (honours Retry-After when present). */
async function fetchWithRetry(url: string, label: string, maxAttempts = 5): Promise<Response> {
  let attempt = 0;
  for (;;) {
    attempt++;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const backoffMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(60_000, 2_000 * 2 ** (attempt - 1)); // 2s,4s,8s,16s,…
      console.warn(
        `  ${label}: HTTP ${res.status} — backoff ${(backoffMs / 1000).toFixed(0)}s (attempt ${attempt}/${maxAttempts})`,
      );
      await sleep(backoffMs);
      continue;
    }
    throw new Error(
      `${label}: HTTP ${res.status} ${res.statusText} — ${(await res.text()).slice(0, 300)}`,
    );
  }
}

async function fetchCoin(id: string): Promise<MarketPoint[]> {
  const url = `${BASE}/${id}/market_chart/range?vs_currency=usd&from=${FROM_SEC}&to=${TO_SEC}`;
  const res = await fetchWithRetry(url, id);
  const body = (await res.json()) as MarketChartRange;

  // market_caps / total_volumes share the same timestamp grid; join on time.
  const volByTime = new Map<number, number>();
  for (const [ms, vol] of body.total_volumes ?? []) volByTime.set(Math.floor(ms / 1000), vol);

  const byTime = new Map<number, MarketPoint>();
  for (const [ms, mcap] of body.market_caps ?? []) {
    const time = Math.floor(ms / 1000);
    byTime.set(time, { time, marketCap: mcap, volume: volByTime.get(time) ?? 0 });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

async function main(): Promise<void> {
  const outDir = join("data", "momq", "marketdata");
  await mkdir(outDir, { recursive: true });

  console.log(`Fetching CoinGecko free historical daily market data (${COINS.length} coins)`);
  console.log(
    `Window: ${new Date(FROM_SEC * 1000).toISOString()} … ${new Date(TO_SEC * 1000).toISOString()}\n`,
  );

  let anyFailed = false;
  for (let i = 0; i < COINS.length; i++) {
    const { id, sym } = COINS[i]!;
    try {
      const points = await fetchCoin(id);
      const file = join(outDir, `${sym}.json`);
      await writeFile(file, JSON.stringify(points, null, 2));
      const first = points[0];
      const last = points[points.length - 1];
      const span =
        first && last
          ? `${new Date(first.time * 1000).toISOString().slice(0, 10)} … ${new Date(last.time * 1000).toISOString().slice(0, 10)}`
          : "(empty)";
      console.log(
        `  ${id.padEnd(17)} → ${sym.padEnd(7)} ${String(points.length).padStart(3)} daily points  ${span}`,
      );
    } catch (err) {
      anyFailed = true;
      console.error(`  ${id.padEnd(17)} → ${sym.padEnd(7)} FAILED: ${(err as Error).message}`);
    }
    // Respect the free rate limit: sleep ~3s between symbols (not after the last).
    if (i < COINS.length - 1) await sleep(3_000);
  }

  if (anyFailed) {
    console.error("\nSome coins failed (rate-limit / region block). The full-validate script");
    console.error(
      "falls back to its existing behaviour for any symbol whose marketdata is missing.",
    );
    process.exit(1);
  }
  console.log("\nDone. Market-data JSONs written to data/momq/marketdata/");
}

void main();
