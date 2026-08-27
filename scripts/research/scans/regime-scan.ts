/**
 * Regime-classification VALIDATION scan — infra stress-test + data characterization.
 *
 * Runs Gordon's OWN regime classifier (`src/core/regime` — `RegimeClassifier.classify`)
 * over a rolling window across every bar of a broad instrument universe, then reports:
 *
 *   1. Per-symbol regime distribution (% of time in each of the 6 regimes).
 *   2. Regime-transition counts (how often the label flips, and into what).
 *   3. A UNIVERSE summary: trend vs chop vs high-vol share of the whole panel, plus a
 *      cross-symbol SYNCHRONIZATION measure — do the symbols flip regime together
 *      (correlated, the thing that breaks "diversification") or independently.
 *   4. ROBUSTNESS: any symbol where the classifier errored, returned a label outside
 *      the taxonomy, or produced degenerate output (NaN/Inf confidence, no variety) is
 *      surfaced as a bug/data-issue — the point is "does the stack survive the panel".
 *
 * This is NOT an alpha hunt. It characterizes what regimes our backtest data contains
 * and validates that the regime stack survives 27 symbols × thousands of real bars
 * without choking. No edge is claimed.
 *
 * Run:  bun run scripts/research/scans/regime-scan.ts
 *
 * Universe is auto-discovered from the bar dir (same convention as alpha-search.ts):
 *   ALPHA_BARS_DIR=data/momq/crypto-extended ALPHA_TF=1h bun run scripts/research/scans/regime-scan.ts
 * Force single-core (debugging):  REGIME_SERIAL=1 bun run scripts/research/scans/regime-scan.ts
 *
 * Uses `RegimeClassifier` directly (the pure classifier) rather than the `RegimeDetector`
 * singleton: the singleton writes every detection to SQLite + caches, which would mean
 * tens of thousands of inserts and shared-state side effects during a read-only scan.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

import { RegimeClassifier } from "../../../src/core/regime/classifier.ts";
import { MarketRegimeSchema, type MarketRegime } from "../../../src/core/regime/types.ts";
import type { Candle } from "../../../src/types/index.ts";

// ── Config ──────────────────────────────────────────────────────────────────

const BARS_DIR = join(process.cwd(), process.env.ALPHA_BARS_DIR ?? join("data", "momq", "bars"));
const TF = process.env.ALPHA_TF ?? "M15"; // bar-file suffix: M15 | 1h | 1d.

// Rolling window the classifier sees at each step. The classifier needs >= 30 candles,
// and EMA-alignment only reaches full quality at >= 100 (below that it degrades to a
// coarse 9-vs-21 proxy). 120 gives EMA-100 room while staying cheap per step.
const WINDOW = 120;
// Step the window forward this many bars between classifications. 1 = every bar (most
// faithful, heaviest). Higher decimates the series; we keep 1 — the panel is small
// enough and the parallelism absorbs it.
const STEP = 1;
// Minimum classifications a symbol must yield to be counted (else flagged degenerate).
const MIN_CLASSIFICATIONS = 30;

const ALL_REGIMES = MarketRegimeSchema.options as readonly MarketRegime[];
const VALID_REGIME_SET = new Set<string>(ALL_REGIMES);

// "Macro" buckets for the universe-level trend/chop/high-vol framing.
const TREND_REGIMES = new Set<MarketRegime>(["trending_up", "trending_down", "breakout"]);
const CHOP_REGIMES = new Set<MarketRegime>(["ranging", "quiet"]);
const HIGHVOL_REGIMES = new Set<MarketRegime>(["volatile", "breakout"]);

// ── Raw bar shape from disk ─────────────────────────────────────────────────

interface RawBar {
  time: number; // seconds
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
  spread: number;
  realVolume: number;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Map a momq bar to the regime engine's Candle. Prefer realVolume, fall back to tick. */
function toCandle(b: RawBar): Candle {
  const volume = Number.isFinite(b.realVolume) && b.realVolume > 0 ? b.realVolume : b.tickVolume;
  const tMs = b.time * 1000;
  return {
    openTime: tMs,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: Number.isFinite(volume) ? volume : 0,
    closeTime: tMs,
  };
}

function loadCandles(symbol: string): Candle[] | null {
  const barPath = join(BARS_DIR, `${symbol}_${TF}.json`);
  if (!existsSync(barPath)) return null;
  const raw = readJson<RawBar[]>(barPath).filter((b) => Number.isFinite(b.close) && b.close > 0);
  if (raw.length < WINDOW + MIN_CLASSIFICATIONS) return null;
  return raw.map(toCandle);
}

// ── Per-symbol scan (the parallelizable unit of work) ───────────────────────

interface SymbolResult {
  symbol: string;
  /** Count of each regime label over the rolling scan. */
  counts: Record<MarketRegime, number>;
  /** Sum of confidence per regime → mean confidence per regime. */
  confSum: Record<MarketRegime, number>;
  /** Total classifications performed. */
  total: number;
  /** Number of label changes (transitions) between consecutive windows. */
  transitions: number;
  /** transitions[from][to] counts. */
  transitionMatrix: Record<string, Record<string, number>>;
  /** Regime label per scan step (for cross-symbol synchronization). aligned by step idx. */
  labelSeries: MarketRegime[];
  /** First scan-step time (ms) and the step stride in ms, to align series across symbols. */
  firstStepTimeMs: number;
  /** Bars covered. */
  bars: number;
  /** Robustness flags. */
  issues: string[];
}

function emptyCounts(): Record<MarketRegime, number> {
  const o = {} as Record<MarketRegime, number>;
  for (const r of ALL_REGIMES) o[r] = 0;
  return o;
}

function scanSymbol(symbol: string): SymbolResult | null {
  const candles = loadCandles(symbol);
  if (!candles) return null;

  const classifier = new RegimeClassifier();
  const counts = emptyCounts();
  const confSum = emptyCounts();
  const transitionMatrix: Record<string, Record<string, number>> = {};
  const labelSeries: MarketRegime[] = [];
  const issues: string[] = [];

  let total = 0;
  let transitions = 0;
  let prev: MarketRegime | null = null;
  let errorCount = 0;
  let firstStepTimeMs = candles[WINDOW - 1]?.closeTime ?? 0;

  for (let end = WINDOW; end <= candles.length; end += STEP) {
    const win = candles.slice(end - WINDOW, end);
    let signal: ReturnType<RegimeClassifier["classify"]>;
    try {
      signal = classifier.classify(win, symbol, TF);
    } catch (err) {
      errorCount += 1;
      if (issues.length < 3) {
        issues.push(
          `classify() threw at bar ${end}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }

    const regime = signal.regime;
    if (!VALID_REGIME_SET.has(regime)) {
      issues.push(`out-of-taxonomy label "${regime}" at bar ${end}`);
      continue;
    }
    if (!Number.isFinite(signal.confidence)) {
      issues.push(`non-finite confidence (${signal.confidence}) for ${regime} at bar ${end}`);
    }

    counts[regime] += 1;
    confSum[regime] += Number.isFinite(signal.confidence) ? signal.confidence : 0;
    labelSeries.push(regime);
    if (total === 0) firstStepTimeMs = win[win.length - 1]!.closeTime;
    total += 1;

    if (prev !== null && prev !== regime) {
      transitions += 1;
      if (!transitionMatrix[prev]) transitionMatrix[prev] = {};
      const transitionsFromPrevious = transitionMatrix[prev]!;
      transitionsFromPrevious[regime] = (transitionsFromPrevious[regime] ?? 0) + 1;
    }
    prev = regime;
  }

  if (errorCount > 0) issues.push(`${errorCount} classify() exceptions total`);
  if (total < MIN_CLASSIFICATIONS) issues.push(`degenerate: only ${total} classifications`);
  const distinct = ALL_REGIMES.filter((r) => counts[r] > 0).length;
  if (total >= MIN_CLASSIFICATIONS && distinct <= 1) {
    issues.push(`degenerate: classifier never left "${labelSeries[0]}" across ${total} windows`);
  }

  return {
    symbol,
    counts,
    confSum,
    total,
    transitions,
    transitionMatrix,
    labelSeries,
    firstStepTimeMs,
    bars: candles.length,
    issues,
  };
}

function scanSymbols(symbols: string[]): SymbolResult[] {
  const out: SymbolResult[] = [];
  for (const sym of symbols) {
    const r = scanSymbol(sym);
    if (r) out.push(r);
  }
  return out;
}

// ── Worker entry: scan a symbol-slice, post results back ────────────────────
if (!isMainThread && parentPort) {
  const { symbols } = workerData as { symbols: string[] };
  parentPort.postMessage(scanSymbols(symbols));
}

function runSharded(symbols: string[]): Promise<SymbolResult[]> {
  const nWorkers = Math.max(1, Math.min(availableParallelism(), symbols.length));
  const chunks: string[][] = Array.from({ length: nWorkers }, () => []);
  symbols.forEach((s, i) => {
    chunks[i % nWorkers]!.push(s);
  });

  return Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<SymbolResult[]>((resolve, reject) => {
          const w = new Worker(new URL(import.meta.url), { workerData: { symbols: chunk } });
          w.once("message", (rows: SymbolResult[]) => {
            resolve(rows);
            void w.terminate();
          });
          w.once("error", reject);
        }),
    ),
  ).then((per) => per.flat());
}

// ── Reporting helpers ───────────────────────────────────────────────────────

function pct(n: number, d: number): string {
  if (d === 0) return "  0.0";
  return ((n / d) * 100).toFixed(1).padStart(5);
}

function fmt(x: number, d = 2): string {
  if (!Number.isFinite(x)) return "n/a";
  return x.toFixed(d);
}

/**
 * Cross-symbol synchronization: at each aligned step, what fraction of symbols share
 * the SAME macro-bucket (trend/chop/highvol)? High mean = regimes flip together
 * (correlated panel — diversification illusion). We align by step INDEX from each
 * symbol's first classification; symbols have different lengths so we measure over the
 * overlap where >= 2 symbols are present. Macro-bucket (not the 6-way label) is the
 * honest granularity: two symbols both "trending" is the correlation that matters for
 * diversification, even if one is trending_up and the other trending_down.
 */
function macroBucket(r: MarketRegime): "trend" | "chop" | "volatile" {
  if (TREND_REGIMES.has(r) && !HIGHVOL_REGIMES.has(r)) return "trend";
  if (r === "breakout") return "trend"; // breakout is a trend-onset bucket here
  if (CHOP_REGIMES.has(r)) return "chop";
  return "volatile";
}

function synchronization(results: SymbolResult[]): {
  meanAgreement: number;
  steps: number;
  bucketShareSeries: { trend: number; chop: number; volatile: number };
} {
  const maxLen = Math.max(0, ...results.map((r) => r.labelSeries.length));
  let agreementAcc = 0;
  let agreementSteps = 0;
  let trendCells = 0;
  let chopCells = 0;
  let volCells = 0;
  let totalCells = 0;

  for (let i = 0; i < maxLen; i++) {
    const buckets: { trend: number; chop: number; volatile: number } = {
      trend: 0,
      chop: 0,
      volatile: 0,
    };
    let present = 0;
    for (const r of results) {
      const lab = r.labelSeries[i];
      if (!lab) continue;
      buckets[macroBucket(lab)] += 1;
      present += 1;
    }
    if (present === 0) continue;
    trendCells += buckets.trend;
    chopCells += buckets.chop;
    volCells += buckets.volatile;
    totalCells += present;
    if (present >= 2) {
      // Agreement = share of symbols in the modal bucket this step.
      const modal = Math.max(buckets.trend, buckets.chop, buckets.volatile);
      agreementAcc += modal / present;
      agreementSteps += 1;
    }
  }

  return {
    meanAgreement: agreementSteps > 0 ? agreementAcc / agreementSteps : 0,
    steps: agreementSteps,
    bucketShareSeries: {
      trend: totalCells > 0 ? trendCells / totalCells : 0,
      chop: totalCells > 0 ? chopCells / totalCells : 0,
      volatile: totalCells > 0 ? volCells / totalCells : 0,
    },
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!existsSync(BARS_DIR)) {
    console.error(`Bar dir not found: ${BARS_DIR}`);
    process.exit(1);
  }

  const suffix = `_${TF}.json`;
  const symbols = readdirSync(BARS_DIR)
    .filter((f) => f.endsWith(suffix))
    .map((f) => f.slice(0, -suffix.length))
    .sort();

  if (symbols.length === 0) {
    console.error(`No ${suffix} bar files in ${BARS_DIR}`);
    process.exit(1);
  }

  const serial = process.env.REGIME_SERIAL === "1" || symbols.length <= 1;
  const nWorkers = serial ? 1 : Math.min(availableParallelism(), symbols.length);

  console.log("=".repeat(82));
  console.log("REGIME-CLASSIFICATION SCAN — Gordon regime stack, rolling-window over the panel");
  console.log("=".repeat(82));
  console.log(`Bar dir            : ${BARS_DIR}`);
  console.log(`Timeframe          : ${TF}`);
  console.log(`Symbols discovered : ${symbols.length} (${symbols.join(", ")})`);
  console.log(`Window / step      : ${WINDOW} bars / ${STEP}`);
  console.log(`Classifier         : RegimeClassifier.classify() — pure, no DB writes`);
  console.log(
    `Parallelism        : ${serial ? "serial (1 core)" : `${nWorkers} workers / ${availableParallelism()} cores`}`,
  );
  console.log("");

  const t0 = Date.now();
  const results: SymbolResult[] = serial ? scanSymbols(symbols) : await runSharded(symbols);
  const elapsedMs = Date.now() - t0;

  results.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const loaded = new Set(results.map((r) => r.symbol));
  const skipped = symbols.filter((s) => !loaded.has(s));

  // ── Per-symbol regime distribution ────────────────────────────────────────
  console.log("PER-SYMBOL REGIME DISTRIBUTION (% of classified windows in each regime)");
  console.log("-".repeat(82));
  const header = [
    "symbol".padEnd(10),
    "wins".padStart(6),
    "tr_up".padStart(6),
    "tr_dn".padStart(6),
    "range".padStart(6),
    "volat".padStart(6),
    "quiet".padStart(6),
    "brkout".padStart(6),
    "flips".padStart(6),
  ].join(" ");
  console.log(header);
  for (const r of results) {
    console.log(
      [
        r.symbol.padEnd(10),
        String(r.total).padStart(6),
        pct(r.counts.trending_up, r.total),
        pct(r.counts.trending_down, r.total),
        pct(r.counts.ranging, r.total),
        pct(r.counts.volatile, r.total),
        pct(r.counts.quiet, r.total),
        pct(r.counts.breakout, r.total),
        String(r.transitions).padStart(6),
      ].join(" "),
    );
  }
  console.log("");

  // ── Universe-level distribution ───────────────────────────────────────────
  const totalWins = results.reduce((a, r) => a + r.total, 0);
  const uni = emptyCounts();
  for (const r of results) for (const reg of ALL_REGIMES) uni[reg] += r.counts[reg];

  console.log("UNIVERSE REGIME DISTRIBUTION (pooled across all symbols)");
  console.log("-".repeat(82));
  for (const reg of ALL_REGIMES) {
    const bar = "█".repeat(Math.round((uni[reg] / Math.max(1, totalWins)) * 50));
    console.log(`  ${reg.padEnd(14)} ${pct(uni[reg], totalWins)}%  ${bar}`);
  }
  const trendShare = ALL_REGIMES.filter((r) => TREND_REGIMES.has(r)).reduce(
    (a, r) => a + uni[r],
    0,
  );
  const chopShare = ALL_REGIMES.filter((r) => CHOP_REGIMES.has(r)).reduce((a, r) => a + uni[r], 0);
  const volShare = uni.volatile;
  console.log("");
  console.log(
    `  Macro framing:  TREND(up/down/breakout) ${pct(trendShare, totalWins)}%   ` +
      `CHOP(range/quiet) ${pct(chopShare, totalWins)}%   VOLATILE ${pct(volShare, totalWins)}%`,
  );
  console.log("");

  // ── Cross-symbol synchronization ──────────────────────────────────────────
  const sync = synchronization(results);
  console.log("CROSS-SYMBOL SYNCHRONIZATION (do regimes flip together?)");
  console.log("-".repeat(82));
  console.log(
    `  Mean macro-bucket agreement across symbols : ${fmt(sync.meanAgreement * 100, 1)}%  (over ${sync.steps} aligned steps)`,
  );
  console.log(
    `    interpretation: 100% = every symbol always in the same macro-regime (fully correlated panel,`,
  );
  console.log(
    `    the 'diversification illusion'); ~33% = independent (3 buckets, no shared regime).`,
  );
  console.log(
    `  Panel macro-share (cell-weighted)          : ` +
      `trend ${fmt(sync.bucketShareSeries.trend * 100, 1)}%  chop ${fmt(sync.bucketShareSeries.chop * 100, 1)}%  volatile ${fmt(sync.bucketShareSeries.volatile * 100, 1)}%`,
  );
  console.log("");

  // ── Transition aggregate ──────────────────────────────────────────────────
  const totalTransitions = results.reduce((a, r) => a + r.transitions, 0);
  const aggMatrix: Record<string, Record<string, number>> = {};
  for (const r of results) {
    for (const [from, tos] of Object.entries(r.transitionMatrix)) {
      for (const [to, n] of Object.entries(tos)) {
        if (!aggMatrix[from]) aggMatrix[from] = {};
        const aggregateFromSource = aggMatrix[from]!;
        aggregateFromSource[to] = (aggregateFromSource[to] ?? 0) + n;
      }
    }
  }
  console.log("REGIME TRANSITIONS (pooled; top flows)");
  console.log("-".repeat(82));
  const flows: { from: string; to: string; n: number }[] = [];
  for (const [from, tos] of Object.entries(aggMatrix)) {
    for (const [to, n] of Object.entries(tos)) flows.push({ from, to, n });
  }
  flows.sort((a, b) => b.n - a.n);
  console.log(
    `  Total transitions across panel : ${totalTransitions}` +
      `  (avg ${fmt(totalTransitions / Math.max(1, results.length), 1)} / symbol, ` +
      `1 flip per ${fmt(totalWins / Math.max(1, totalTransitions), 1)} windows)`,
  );
  for (const f of flows.slice(0, 10)) {
    console.log(`    ${f.from.padEnd(14)} -> ${f.to.padEnd(14)} ${String(f.n).padStart(6)}`);
  }
  console.log("");

  // ── Robustness / failures ─────────────────────────────────────────────────
  console.log("ROBUSTNESS / CLASSIFIER HEALTH");
  console.log("-".repeat(82));
  console.log(`  Symbols scanned OK : ${results.length} / ${symbols.length}`);
  console.log(
    `  Symbols skipped    : ${skipped.length}${skipped.length ? ` (too few bars: ${skipped.join(", ")})` : ""}`,
  );
  const flagged = results.filter((r) => r.issues.length > 0);
  if (flagged.length === 0) {
    console.log(
      `  Issues             : NONE — classifier survived ${totalWins} windows across the panel with`,
    );
    console.log(
      `                       no exceptions, no out-of-taxonomy labels, no NaN confidence, no`,
    );
    console.log(`                       degenerate (single-label) symbols.`);
  } else {
    console.log(`  Issues             : ${flagged.length} symbol(s) flagged:`);
    for (const r of flagged) {
      console.log(`    • ${r.symbol}: ${r.issues.join("; ")}`);
    }
  }
  console.log("");

  console.log("=".repeat(82));
  console.log(
    `Scanned ${totalWins} windows across ${results.length} symbols in ${(elapsedMs / 1000).toFixed(1)}s. ` +
      `Characterization + infra validation only — no edge claimed.`,
  );
  console.log("=".repeat(82));
}

if (isMainThread) void main();
