/**
 * Fetch EXTENDED multi-regime crypto history from Binance public klines — FAST.
 *
 * Why: our competition-month dataset is one choppy down-regime. Robust backtesting
 * + a real test of the infra needs YEARS of data across bull / bear / chop and a
 * WIDE universe (for cross-sectional / pairs breadth). This pulls read-only, no-auth
 * public spot klines for the top-N most-liquid USDT pairs (universe derived from the
 * Binance 24h ticker, NOT hardcoded — except the 5 competition pairs are pinned in),
 * across M15 / 1h / 1d, in the same bar shape used under data/momq/.
 *
 * Read-only public data only. No keys, no orders. Safe to run.
 *
 *   bun run scripts/research/data/fetch-crypto-history-extended.ts
 *
 * Speed: a concurrency POOL issues page requests in parallel, throttled by a single
 * GLOBAL rate-pacer (~3.5 req/s) so we ride the Binance weight ceiling without 429s —
 * network round-trips overlap instead of running strictly serial.
 *
 * Optional env:
 *   GORDON_FETCH_TFS=M15,1h,1d          restrict timeframes
 *   GORDON_FETCH_TOPN=50                top-N USDT pairs by 24h quote volume (default 50)
 *   GORDON_FETCH_M15_YEARS=1.5          M15 depth in years (default 1.5)
 *   GORDON_FETCH_H1_YEARS=3             1h depth in years (default 3)
 *   GORDON_FETCH_D1_YEARS=8             1d depth in years (default 8)
 *   GORDON_FETCH_SYMBOLS=BTCUSDT,...    explicit pair list (overrides top-N discovery)
 *   GORDON_FETCH_CONCURRENCY=8          parallel in-flight jobs (default 8)
 *   GORDON_FETCH_SPACING_MS=280         global min ms between requests (rate-pacer)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BINANCE_BASE = "https://api.binance.com/api/v3";
const OUT_DIR = join(process.cwd(), "data", "momq", "crypto-extended");
const DAY_MS = 86_400_000;

const TF_CONFIG = { M15: "15m", "1h": "1h", "1d": "1d" } as const;
type Timeframe = keyof typeof TF_CONFIG;

function num(v: string | undefined, fallback: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function depthYears(tf: string): number {
  if (tf === "M15") return num(process.env.GORDON_FETCH_M15_YEARS, 1.5);
  if (tf === "1h") return num(process.env.GORDON_FETCH_H1_YEARS, 3);
  return num(process.env.GORDON_FETCH_D1_YEARS, 8);
}

// The 5 competition pairs are always included (comp symbol differs for HBAR -> BAR).
const COMP_PAIRS: Array<{ pair: string; symbol: string }> = [
  { pair: "BTCUSDT", symbol: "BTCUSD" },
  { pair: "ETHUSDT", symbol: "ETHUSD" },
  { pair: "SOLUSDT", symbol: "SOLUSD" },
  { pair: "XRPUSDT", symbol: "XRPUSD" },
  { pair: "HBARUSDT", symbol: "BARUSD" },
];

// Exclude leveraged tokens, stablecoin/stablecoin pairs, and wrapped/fiat noise from
// the cross-sectional universe (they aren't independent risk assets).
const STABLE_BASES = new Set([
  "USDC",
  "BUSD",
  "TUSD",
  "DAI",
  "FDUSD",
  "USDP",
  "EUR",
  "GBP",
  "AEUR",
  "USD1",
]);
const LEVERAGED = /(UP|DOWN|BULL|BEAR)USDT$/;

interface Bar {
  time: number; // epoch seconds (open time)
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number; // = number of trades
  spread: number; // = 0 (klines carry no spread)
  realVolume: number; // = base-asset volume
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Global request rate-pacer ────────────────────────────────────────────────
// Serializes the TIMING of every outbound request (not the work) so N concurrent
// jobs collectively stay under the Binance weight limit (~1200/min; klines@1000 = 5
// weight → ~240 req/min ceiling). Default 280ms ≈ 3.5 req/s ≈ 1050 weight/min.
const SPACING_MS = num(process.env.GORDON_FETCH_SPACING_MS, 280);
let nextSlot = 0;
async function pacedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + SPACING_MS;
  const wait = at - now;
  if (wait > 0) await sleep(wait);
  return fetch(url);
}

/** Discover the top-N most-liquid USDT spot pairs by 24h quote volume. */
async function discoverTopPairs(n: number): Promise<Array<{ pair: string; symbol: string }>> {
  const res = await pacedFetch(`${BINANCE_BASE}/ticker/24hr`);
  if (!res.ok) throw new Error(`ticker/24hr ${res.status}`);
  const rows = (await res.json()) as Array<{ symbol: string; quoteVolume: string }>;
  const ranked = rows
    .filter((r) => r.symbol.endsWith("USDT") && !LEVERAGED.test(r.symbol))
    .filter((r) => !STABLE_BASES.has(r.symbol.slice(0, -4)))
    .map((r) => ({ pair: r.symbol, base: r.symbol.slice(0, -4), vol: Number(r.quoteVolume) }))
    .filter((r) => Number.isFinite(r.vol))
    .sort((a, b) => b.vol - a.vol);

  const out: Array<{ pair: string; symbol: string }> = [...COMP_PAIRS];
  const have = new Set(out.map((p) => p.pair));
  for (const r of ranked) {
    if (out.length >= n) break;
    if (have.has(r.pair)) continue;
    have.add(r.pair);
    out.push({ pair: r.pair, symbol: `${r.base}USD` });
  }
  return out;
}

/** One paginated kline pull. Chronological, de-duped. Handles 429/418 backoff. */
async function fetchKlines(pair: string, interval: string, startTime: number): Promise<Bar[]> {
  const bars: Bar[] = [];
  let cursor = startTime;
  const now = Date.now();
  let backoff = 1000;

  while (cursor < now) {
    const url = `${BINANCE_BASE}/klines?symbol=${pair}&interval=${interval}&startTime=${cursor}&endTime=${now}&limit=1000`;
    let res: Response;
    try {
      res = await pacedFetch(url);
    } catch (err) {
      if (backoff > 32_000) throw err;
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
      continue;
    }
    if (res.status === 429 || res.status === 418) {
      const ra = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff;
      await sleep(waitMs);
      backoff = Math.min(backoff * 2, 60_000);
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Binance ${res.status} for ${pair} ${interval}: ${body.slice(0, 160)}`);
    }
    backoff = 1000;

    const rows = (await res.json()) as unknown[][];
    if (rows.length === 0) break;
    for (const row of rows) {
      bars.push({
        time: Math.floor(Number(row[0]) / 1000),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        tickVolume: Number(row[8]),
        spread: 0,
        realVolume: Number(row[5]),
      });
    }
    const next = Number(rows[rows.length - 1]![6]) + 1;
    if (next <= cursor) break;
    cursor = next;
    if (rows.length < 1000) break;
  }

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

const fmtDate = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);

/** Run async jobs through a fixed-size concurrency pool. */
async function pool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      await worker(items[i]!);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const tfFilter = (process.env.GORDON_FETCH_TFS || "M15,1h,1d")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Timeframe => s in TF_CONFIG);

  let pairs: Array<{ pair: string; symbol: string }>;
  if (process.env.GORDON_FETCH_SYMBOLS) {
    const want = process.env.GORDON_FETCH_SYMBOLS.split(",").map((s) => s.trim().toUpperCase());
    pairs = want.map((p) => ({ pair: p, symbol: `${p.replace(/USDT$/, "")}USD` }));
  } else {
    const topN = num(process.env.GORDON_FETCH_TOPN, 50);
    console.log(`Discovering top-${topN} USDT pairs by 24h volume...`);
    pairs = await discoverTopPairs(topN);
  }

  const concurrency = num(process.env.GORDON_FETCH_CONCURRENCY, 8);
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`Output dir: ${OUT_DIR}`);
  console.log(
    `Timeframes: ${tfFilter.join(", ")}  |  pairs: ${pairs.length}  |  concurrency: ${concurrency}  |  spacing: ${SPACING_MS}ms`,
  );
  console.log(`Pairs: ${pairs.map((p) => p.pair).join(", ")}\n`);

  type Cov = { bars: number; from: string; to: string; bytes: number };
  const coverage: Record<string, Cov> = {};
  const failures: string[] = [];
  let totalBytes = 0;
  let totalBars = 0;
  let done = 0;

  const jobs: Array<{ pair: string; symbol: string; tf: Timeframe }> = [];
  for (const p of pairs) for (const tf of tfFilter) jobs.push({ ...p, tf });

  await pool(jobs, concurrency, async ({ pair, symbol, tf }) => {
    const key = `${symbol}_${tf}`;
    const startTime = Date.now() - depthYears(tf) * 365 * DAY_MS;
    try {
      const bars = await fetchKlines(pair, TF_CONFIG[tf], startTime);
      const first = bars[0];
      const last = bars[bars.length - 1];
      if (!first || !last) {
        failures.push(`${key}: no data`);
      } else {
        const json = JSON.stringify(bars);
        await writeFile(join(OUT_DIR, `${key}.json`), json);
        const bytes = Buffer.byteLength(json);
        totalBytes += bytes;
        totalBars += bars.length;
        coverage[key] = {
          bars: bars.length,
          from: fmtDate(first.time),
          to: fmtDate(last.time),
          bytes,
        };
      }
    } catch (err) {
      failures.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
    done += 1;
    if (done % 10 === 0 || done === jobs.length) {
      console.log(
        `  [${done}/${jobs.length}] ${(totalBytes / 1e6).toFixed(0)} MB, ${totalBars.toLocaleString()} bars so far`,
      );
    }
  });

  console.log("\n==================== COVERAGE ====================");
  for (const k of Object.keys(coverage).sort()) {
    const c = coverage[k]!;
    console.log(
      `${k.padEnd(16)} ${String(c.bars).padStart(7)} bars  ${c.from} -> ${c.to}  ${(c.bytes / 1e6).toFixed(2)} MB`,
    );
  }
  console.log("=================================================");
  console.log(`Datasets written: ${Object.keys(coverage).length} / ${jobs.length} jobs`);
  console.log(`Total bars:       ${totalBars.toLocaleString()}`);
  console.log(`Total size:       ${(totalBytes / 1e6).toFixed(2)} MB`);
  if (failures.length) {
    console.log(`\nFailures (${failures.length}):`);
    for (const f of failures.slice(0, 30)) console.log(`  - ${f}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
