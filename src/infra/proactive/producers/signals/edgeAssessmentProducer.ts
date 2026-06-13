/**
 * Edge Assessment Producer — the live deployment of EDD's Phase 5
 * ("monitor-invariants-live").
 *
 * Every tick it loads the in-force EDGE.md specs (status: live) and evaluates
 * each one's invariants + kill conditions against current market metrics via
 * assessEdge(). A live edge that stops being true doesn't wait for a human to
 * notice: when an invariant the producer can MEASURE breaks, it fires a degraded
 * card; when a kill condition fires, it fires an urgent retire card.
 *
 * Honest scope: this producer supplies the MARKET-OBSERVABLE metrics it can
 * derive from public candles — `regime`, `volumePattern`, `avgVol1mUsd`. Trade-
 * derived invariants (`netEdgeBps`, `winRate`) need the realized-trade ledger and
 * are not wired here yet; they fail SAFE (a missing metric never fires a card),
 * so the producer never alarms on data it cannot see. When the ledger is wired,
 * pass rMultiples into assessEdge() and decay composes in for free.
 *
 * Fires only on a health TRANSITION that worsens (stable→degraded, →retire,
 * degraded→retire) so a persistently-degraded edge doesn't re-alert every tick.
 */

import { join } from "node:path";
import type { CandidateProducer } from "../../engine/proactiveEngine.ts";
import { buildCandidate } from "../../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../../types.ts";
import { createModuleLogger } from "../../../logger/index.ts";
import { GORDON_DIR } from "../../../storage/paths.ts";
import { fetchRecentCandles, type ProactiveCandle } from "../candleFetch.ts";
import { composeHealth, loadLiveEdges, type EdgeHealth, type EdgeMetrics, type EdgeSpec } from "../../../../core/edge/index.ts";
import { assessEdge } from "../../../trading/ops/edgeStatus.ts";

const logger = createModuleLogger("edge-assessment-producer");

const TIMEFRAME = "1h";
const CANDLE_COUNT = 100;

/** Last-alerted health per `${edgeName}::${symbol}`. Transition-only firing. */
const lastLevelByKey = new Map<string, EdgeHealth>();

const SEVERITY: Record<EdgeHealth, number> = { stable: 0, degraded: 1, retire: 2 };

interface RegimeSignal { regime: string; confidence: number; metrics?: Record<string, number> }
interface RegimeDetectorClass {
  getInstance: () => { detectRegime: (candles: unknown[], symbol: string, timeframe?: string) => RegimeSignal };
}

async function loadRegimeDetector(): Promise<
  { detectRegime: (candles: unknown[], symbol: string, timeframe?: string) => RegimeSignal } | null
> {
  try {
    const mod = (await import("../../../../core/regime/detector.ts" as string)) as {
      RegimeDetector?: RegimeDetectorClass;
    };
    if (!mod.RegimeDetector || typeof mod.RegimeDetector.getInstance !== "function") return null;
    return mod.RegimeDetector.getInstance();
  } catch (err) {
    logger.debug("RegimeDetector not accessible", { err: String(err) });
    return null;
  }
}

/**
 * Recent realized R-multiples for a playbook, most-recent-first (the order
 * evaluateDecay wants). Reads the trade-outcome ledger; fails safe to [] if the
 * ledger is unavailable, so a fresh edge with no trade history simply gets no
 * decay verdict (invariants still gate it).
 */
async function loadRecentRMultiples(strategy: string): Promise<number[]> {
  try {
    const mod = (await import("../../../domain/evals/index.ts" as string)) as {
      getTradeOutcomes?: (f: { strategy?: string; limit?: number }) => Array<{ riskRewardActual?: number }>;
    };
    if (typeof mod.getTradeOutcomes !== "function") return [];
    return mod
      .getTradeOutcomes({ strategy, limit: 70 })
      .map((o) => o.riskRewardActual)
      .filter((r): r is number => typeof r === "number" && Number.isFinite(r));
  } catch (err) {
    logger.debug("trade outcomes unavailable", { strategy, err: String(err) });
    return [];
  }
}

/** Normalize an edge instrument ("BTC/USDT") to the candle-fetch symbol key. */
export function normalizeInstrument(instrument: string): string {
  const upper = instrument.toUpperCase().replace(/[-/_\s]/g, "");
  if (upper.endsWith("USDT") || upper.endsWith("USD")) return upper;
  return `${upper}USDT`;
}

/** Classify recent volume as increasing / decreasing / flat from OHLCV bars. */
export function computeVolumePattern(candles: ProactiveCandle[]): "increasing" | "decreasing" | "flat" {
  if (candles.length < 24) return "flat";
  const recent = candles.slice(-6);
  const prior = candles.slice(-24, -6);
  const avg = (xs: ProactiveCandle[]) => xs.reduce((s, c) => s + c.volume, 0) / xs.length;
  const priorAvg = avg(prior);
  if (priorAvg <= 0) return "flat";
  const ratio = avg(recent) / priorAvg;
  if (ratio >= 1.2) return "increasing";
  if (ratio <= 0.8) return "decreasing";
  return "flat";
}

/** Derive the market-observable metric bag the producer can supply for an edge. */
export function collectEdgeMetrics(
  symbol: string,
  candles: ProactiveCandle[],
  detector: { detectRegime: (c: unknown[], s: string, tf?: string) => RegimeSignal } | null,
): EdgeMetrics {
  const metrics: EdgeMetrics = {
    volumePattern: computeVolumePattern(candles),
    price: candles.at(-1)?.close,
  };
  const window = candles.slice(-24);
  if (window.length > 0) {
    const usdPerHour = window.reduce((s, c) => s + c.close * c.volume, 0) / window.length;
    metrics.avgVol1mUsd = usdPerHour / 60; // 1h bar → per-minute proxy
  }
  if (detector) {
    try {
      metrics.regime = detector.detectRegime(candles, symbol, TIMEFRAME).regime;
    } catch (err) {
      logger.debug("detectRegime threw", { symbol, err: String(err) });
    }
  }
  return metrics;
}

/**
 * Pure decision core: assess each live edge against the collected metrics and
 * return cards for edges whose health worsened since last tick. Mutates
 * `lastLevel` (the caller owns it) so firing is transition-only.
 */
export function computeEdgeAlerts(
  edges: EdgeSpec[],
  metricsBySymbol: Map<string, EdgeMetrics>,
  lastLevel: Map<string, EdgeHealth>,
  rMultiplesByStrategy: Map<string, ReadonlyArray<number>> = new Map(),
): ProactiveSuggestion[] {
  const cards: ProactiveSuggestion[] = [];

  for (const edge of edges) {
    for (const instrument of edge.instruments) {
      const symbol = normalizeInstrument(instrument);
      const metrics = metricsBySymbol.get(symbol);
      if (!metrics) continue;

      // Realized R-multiples are tagged by playbook (strategy), so edges that
      // share a playbook share a decay score — fine: decay is the playbook's
      // realized performance. assessEdge folds decay in when R is present.
      const rMultiples = rMultiplesByStrategy.get(edge.strategy);
      const assessment = assessEdge(edge, metrics, rMultiples);
      const firedKills = assessment.invariants.firedKills;
      // Only invariants we could actually MEASURE (metric present) count as an
      // alertable break — a missing metric must never raise a card.
      const measurableViolations = assessment.invariants.violatedInvariants.filter(
        (c) => c.value !== undefined,
      );

      // Fold two independent verdicts: the market-observable invariant check and
      // the statistical decay check (realized R, immune to missing market data).
      let invariantLevel: EdgeHealth;
      if (firedKills.length > 0) invariantLevel = "retire";
      else if (measurableViolations.length > 0) invariantLevel = "degraded";
      else invariantLevel = "stable";
      const level = composeHealth(invariantLevel, assessment.decay?.state ?? "stable");

      const key = `${edge.name}::${symbol}`;
      const prev = lastLevel.get(key) ?? "stable";
      lastLevel.set(key, level);

      // Fire only when health worsened (transition-only, no improvement spam).
      if (SEVERITY[level] <= SEVERITY[prev] || level === "stable") continue;

      cards.push(buildEdgeCard(edge, instrument, symbol, level, assessment, measurableViolations));
    }
  }

  return cards;
}

function buildEdgeCard(
  edge: EdgeSpec,
  instrument: string,
  symbol: string,
  level: EdgeHealth,
  assessment: ReturnType<typeof assessEdge>,
  measurableViolations: ReturnType<typeof assessEdge>["invariants"]["violatedInvariants"],
): ProactiveSuggestion {
  const firedKills = assessment.invariants.firedKills;
  const decay = assessment.decay;

  // An edge can die two ways at once — an invariant/kill on live market data
  // AND realized-R decay. Name every driver that contributed to this verdict.
  const drivers: string[] = [];
  const breakIds: string[] = [];
  for (const c of firedKills) {
    drivers.push(`kill ${c.invariant.id} fired (${c.invariant.metric}=${String(c.value)})`);
    breakIds.push(c.invariant.id);
  }
  for (const c of measurableViolations) {
    drivers.push(`invariant ${c.invariant.id} broke (${c.invariant.metric}=${String(c.value)} not ${c.invariant.comparator} ${formatThreshold(c.invariant.threshold)})`);
    breakIds.push(c.invariant.id);
  }
  if (decay && decay.state !== "stable") {
    drivers.push(`realized R decayed to ${(decay.ratio * 100).toFixed(0)}% of baseline (recent ${decay.recentExpectancy.toFixed(2)}R vs ${decay.baselineExpectancy.toFixed(2)}R)`);
    breakIds.push("decay");
  }
  const driverText = drivers.join("; ");

  const title =
    level === "retire"
      ? `Edge "${edge.name}" should RETIRE on ${instrument}`
      : `Edge "${edge.name}" degraded on ${instrument}`;

  const sizeHint =
    level !== "retire" && assessment.recommendedSizeMultiplier < 1
      ? ` Scale ${edge.strategy} to ~${assessment.recommendedSizeMultiplier.toFixed(2)}× on ${instrument}.`
      : "";

  const body =
    level === "retire"
      ? `The live edge "${edge.name}" (playbook ${edge.strategy}) should retire on ${instrument}: ${driverText}. ` +
        `The thesis that justified capital here no longer holds — pull the edge, flip it to status: retired, ` +
        `and stop sizing ${edge.strategy} on ${instrument} until it re-passes the gauntlet.`
      : `The live edge "${edge.name}" (playbook ${edge.strategy}) degraded on ${instrument}: ${driverText}.${sizeHint} ` +
        `Degraded, not dead — scale down and watch for a kill.`;

  return buildCandidate("edge_health", title, body, {
    confidence: level === "retire" ? 0.9 : 0.78,
    severity: level === "retire" ? "urgent" : "normal",
    action:
      level === "retire"
        ? `Retire edge "${edge.name}" — set status: retired and pull ${edge.strategy} on ${instrument}`
        : `Scale down ${edge.strategy} on ${instrument}; re-check edge "${edge.name}"`,
    triggers: {
      source: "monitor_loop",
      eventType: "tick_edge_assessment",
      symbol,
      metadata: {
        edge: edge.name,
        strategy: edge.strategy,
        health: level,
        breaks: breakIds,
        decayRatio: decay?.ratio,
        sizeMultiplier: assessment.recommendedSizeMultiplier,
      },
    },
    operation: {
      tool: "detect_market_regime",
      args: { symbol: symbol.replace(/USDT$/, ""), timeframe: TIMEFRAME },
      readOnly: true,
      description: `Confirm the regime driving edge "${edge.name}" on ${instrument}`,
    },
  });
}

function formatThreshold(t: number | string | string[]): string {
  return Array.isArray(t) ? t.join(",") : String(t);
}

export const edgeAssessmentProducer: CandidateProducer = async (obs): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_edge_assessment") return [];

  const edges = loadLiveEdges([join(GORDON_DIR, "edges")]);
  if (edges.length === 0) return [];

  const detector = await loadRegimeDetector();

  // One fetch per distinct instrument across all live edges.
  const symbols = [...new Set(edges.flatMap((e) => e.instruments.map(normalizeInstrument)))];
  const metricsBySymbol = new Map<string, EdgeMetrics>();
  // One realized-R lookup per distinct playbook (strategy) across all live edges.
  const strategies = [...new Set(edges.map((e) => e.strategy).filter(Boolean))];
  const rMultiplesByStrategy = new Map<string, ReadonlyArray<number>>();

  await Promise.allSettled([
    ...symbols.map(async (symbol) => {
      const candles = await fetchRecentCandles(symbol, TIMEFRAME, CANDLE_COUNT);
      if (candles.length < 24) return;
      metricsBySymbol.set(symbol, collectEdgeMetrics(symbol, candles, detector));
    }),
    ...strategies.map(async (strategy) => {
      rMultiplesByStrategy.set(strategy, await loadRecentRMultiples(strategy));
    }),
  ]);

  return computeEdgeAlerts(edges, metricsBySymbol, lastLevelByKey, rMultiplesByStrategy);
};

/** Reset the per-edge health memory. Called on producer unregister. */
export function resetEdgeAssessmentProducerState(): void {
  lastLevelByKey.clear();
}
