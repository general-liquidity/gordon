/**
 * Fetch EXTENDED multi-regime crypto history from Binance public klines.
 *
 * Why: our competition-month dataset is one choppy down-regime. Robust
 * backtesting needs years of data spanning bull / bear / chop. This pulls
 * read-only, no-auth public spot klines for the 5 competition pairs plus a
 * broad liquid set, across M15 / 1h / 1d, and writes them in the same bar
 * shape used under data/momq/bars/.
 *
 * Read-only public data only. No keys, no orders. New script — safe to run.
 *
 *   bun run scripts/research/fetch-crypto-history-extended.ts
 *
 * Optional env:
 *   GORDON_FETCH_TFS=M15,1h,1d         restrict timeframes
 *   GORDON_FETCH_M15_YEARS=1           M15 depth in years (default 1)
 *   GORDON_FETCH_H1_YEARS=3            1h depth in years (default 3)
 *   GORDON_FETCH_D1_YEARS=3            1d depth in years (default 3)
 *   GORDON_FETCH_SYMBOLS=BTCUSDT,...   restrict to a subset of Binance pairs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BINANCE_BASE = "https://api.binance.com/api/v3/klines";
const OUT_DIR = join(process.cwd(), "data", "momq", "crypto-extended");

const DAY_MS = 86_400_000;

// Binance interval string per timeframe label.
const TF_CONFIG = {
  M15: "15m",
  "1h": "1h",
  "1d": "1d",
} as const;

type Timeframe = keyof typeof TF_CONFIG;

// Default depth (years) per timeframe. M15 is the heaviest; cap it lower so
// the run finishes in minutes. Daily is cheap — go back further.
function depthYears(tf: string): number {
  if (tf === "M15") return num(process.env.GORDON_FETCH_M15_YEARS, 1);
  if (tf === "1h") return num(process.env.GORDON_FETCH_H1_YEARS, 3);
  return num(process.env.GORDON_FETCH_D1_YEARS, 3);
}

function num(v: string | undefined, fallback: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Competition crypto first, then a broad liquid set for cross-sectional
// breadth. Map: Binance USDT pair -> comp/bar symbol (strip USDT, keep base).
const PAIRS: Array<{ pair: string; symbol: string }> = [
  // 5 competition pairs (comp symbols differ for HBAR -> BAR).
  { pair: "BTCUSDT", symbol: "BTCUSD" },
  { pair: "ETHUSDT", symbol: "ETHUSD" },
  { pair: "SOLUSDT", symbol: "SOLUSD" },
  { pair: "XRPUSDT", symbol: "XRPUSD" },
  { pair: "HBARUSDT", symbol: "BARUSD" },
  // Broader liquid majors for breadth (base ticker + USD).
  { pair: "BNBUSDT", symbol: "BNBUSD" },
  { pair: "ADAUSDT", symbol: "ADAUSD" },
  { pair: "DOGEUSDT", symbol: "DOGEUSD" },
  { pair: "AVAXUSDT", symbol: "AVAXUSD" },
  { pair: "LINKUSDT", symbol: "LINKUSD" },
  { pair: "DOTUSDT", symbol: "DOTUSD" },
  { pair: "MATICUSDT", symbol: "MATICUSD" },
  { pair: "LTCUSDT", symbol: "LTCUSD" },
  { pair: "TRXUSDT", symbol: "TRXUSD" },
  { pair: "ATOMUSDT", symbol: "ATOMUSD" },
  { pair: "NEARUSDT", symbol: "NEARUSD" },
  { pair: "APTUSDT", symbol: "APTUSD" },
  { pair: "ARBUSDT", symbol: "ARBUSD" },
  { pair: "OPUSDT", symbol: "OPUSD" },
  { pair: "INJUSDT", symbol: "INJUSD" },
  { pair: "SUIUSDT", symbol: "SUIUSD" },
  { pair: "FILUSDT", symbol: "FILUSD" },
  { pair: "UNIUSDT", symbol: "UNIUSD" },
  { pair: "AAVEUSDT", symbol: "AAVEUSD" },
];

interface Bar {
  time: number; // epoch seconds (open time)
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number; // = number of trades
  spread: number; // = 0
  realVolume: number; // = base-asset volume
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One paginated kline pull for a (pair, timeframe). Returns chronologically
 * sorted, de-duplicated bars. Handles 429/418 with backoff + Retry-After.
 */
async function fetchKlines(
  pair: string,
  interval: string,
  startTime: number,
): Promise<Bar[]> {
  const bars: Bar[] = [];
  let cursor = startTime;
  const now = Date.now();
  let backoff = 1000;

  while (cursor < now) {
    const url =
      `${BINANCE_BASE}?symbol=${pair}&interval=${interval}` +
      `&startTime=${cursor}&endTime=${now}&limit=1000`;

    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      // Transient network error — back off and retry.
      if (backoff > 32_000) throw err;
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
      continue;
    }

    if (res.status === 429 || res.status === 418) {
      const ra = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff;
      console.warn(
        `    rate-limited (${res.status}) on ${pair} ${interval}; waiting ${Math.round(waitMs / 1000)}s`,
      );
      await sleep(waitMs);
      backoff = Math.min(backoff * 2, 60_000);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Binance ${res.status} for ${pair} ${interval}: ${body.slice(0, 200)}`);
    }

    backoff = 1000; // reset on success

    const rows = (await res.json()) as unknown[][];
    if (rows.length === 0) break;

    for (const row of rows) {
      // Binance kline tuple:
      // [openTime, open, high, low, close, volume, closeTime, quoteVolume,
      //  numTrades, takerBuyBase, takerBuyQuote, ignore]
      const openTime = Number(row[0]);
      bars.push({
        time: Math.floor(openTime / 1000),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        tickVolume: Number(row[8]),
        spread: 0,
        realVolume: Number(row[5]),
      });
    }

    const lastRow = rows[rows.length - 1]!;
    const lastClose = Number(lastRow[6]);
    const next = lastClose + 1;
    if (next <= cursor) break; // no forward progress — stop
    cursor = next;

    // Fewer than a full page means we've reached the present.
    if (rows.length < 1000) break;

    // Respect weight limits — gentle pacing between pages.
    await sleep(250);
  }

  // De-dupe by open time (page boundaries can overlap by one bar).
  const seen = new Set<number>();
  const out: Bar[] = [];
  for (const b of bars) {
    if (seen.has(b.time)) continue;
    seen.add(b.time);
    out.push(b);
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

function fmtDate(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().slice(0, 10);
}

async function main() {
  const tfFilter = (process.env.GORDON_FETCH_TFS || "M15,1h,1d")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Timeframe => s in TF_CONFIG);

  const symFilter = process.env.GORDON_FETCH_SYMBOLS
    ? new Set(process.env.GORDON_FETCH_SYMBOLS.split(",").map((s) => s.trim().toUpperCase()))
    : null;
  const pairs = symFilter ? PAIRS.filter((p) => symFilter.has(p.pair)) : PAIRS;

  await mkdir(OUT_DIR, { recursive: true });

  console.log(`Output dir: ${OUT_DIR}`);
  console.log(`Timeframes: ${tfFilter.join(", ")}`);
  console.log(`Pairs (${pairs.length}): ${pairs.map((p) => p.pair).join(", ")}\n`);

  type Coverage = { bars: number; from: string; to: string; bytes: number };
  const coverage: Record<string, Coverage> = {};
  let totalBytes = 0;
  let totalBars = 0;
  const failures: string[] = [];

  for (const { pair, symbol } of pairs) {
    for (const tf of tfFilter) {
      const interval = TF_CONFIG[tf];
      const startTime = Date.now() - depthYears(tf) * 365 * DAY_MS;
      const key = `${symbol}_${tf}`;
      process.stdout.write(`Fetching ${pair} (${symbol}) ${tf} ... `);
      try {
        const bars = await fetchKlines(pair, interval, startTime);
        const first = bars[0];
        const last = bars[bars.length - 1];
        if (!first || !last) {
          console.log("no data (pair may not exist on Binance spot)");
          failures.push(`${key}: no data`);
          continue;
        }
        const json = JSON.stringify(bars);
        const file = join(OUT_DIR, `${key}.json`);
        await writeFile(file, json);
        const bytes = Buffer.byteLength(json);
        totalBytes += bytes;
        totalBars += bars.length;
        const cov = {
          bars: bars.length,
          from: fmtDate(first.time),
          to: fmtDate(last.time),
          bytes,
        };
        coverage[key] = cov;
        console.log(
          `${bars.length} bars  ${cov.from} -> ${cov.to}  (${(bytes / 1e6).toFixed(2)} MB)`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`FAILED: ${msg}`);
        failures.push(`${key}: ${msg}`);
      }
      // Small pause between (pair,tf) jobs to be polite to the weight limit.
      await sleep(200);
    }
  }

  // Summary.
  console.log("\n==================== COVERAGE ====================");
  const keys = Object.keys(coverage).sort();
  for (const k of keys) {
    const c = coverage[k];
    if (!c) continue;
    console.log(
      `${k.padEnd(16)} ${String(c.bars).padStart(7)} bars  ${c.from} -> ${c.to}  ${(c.bytes / 1e6).toFixed(2)} MB`,
    );
  }
  console.log("=================================================");
  console.log(`Datasets written: ${keys.length}`);
  console.log(`Total bars:       ${totalBars.toLocaleString()}`);
  console.log(`Total size:       ${(totalBytes / 1e6).toFixed(2)} MB`);
  if (failures.length > 0) {
    console.log(`\nFailures (${failures.length}):`);
    for (const f of failures) console.log(`  - ${f}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
