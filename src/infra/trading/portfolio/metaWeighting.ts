/**
 * Janus Meta-Weighting — Dynamic Signal Source Weighting
 *
 * Sits above multiple signal sources (indicators, strategies, patterns)
 * and dynamically weights them by recent accuracy. Sources that predicted
 * correctly get upweighted; wrong ones get downweighted.
 *
 * Emergent regime detection: when short-term signals outperform long-term
 * → "novel regime" (unusual market). Weight differential IS the regime signal.
 *
 * Source: Atlas GIC (General Intelligence Capital) — Janus layer
 */

// ============================================================================
// Types
// ============================================================================

export interface SignalSource {
  id: string;
  name: string;
  /** Window of data this source uses (days). Short = reactive, long = stable. */
  lookbackDays: number;
  /** Current weight (0.3 to 2.5). */
  weight: number;
  /** Rolling accuracy over last N predictions. */
  accuracy: number;
  /** Rolling Sharpe of this source's recommendations. */
  rollingSharpe: number;
  /** Number of predictions made. */
  predictionCount: number;
}

export interface WeightedPrediction {
  symbol: string;
  direction: "long" | "short" | "neutral";
  /** Raw conviction from the source (0-100). */
  rawConviction: number;
  /** Weighted conviction (raw × source weight). */
  weightedConviction: number;
  sourceId: string;
  sourceName: string;
}

export interface BlendedRecommendation {
  symbol: string;
  direction: "long" | "short" | "neutral";
  /** Final conviction after blending all sources. */
  finalConviction: number;
  /** Whether sources disagree on direction. */
  contested: boolean;
  /** Disagreement penalty applied. */
  disagreementPenalty: number;
  /** Contributing sources. */
  contributors: Array<{ sourceId: string; direction: string; weightedConviction: number }>;
}

export type EmergentRegime = "novel_regime" | "historical_regime" | "mixed";

export interface MetaWeightingResult {
  recommendations: BlendedRecommendation[];
  regime: EmergentRegime;
  /** Weight differential between short-term and long-term sources. */
  regimeSignalStrength: number;
  /** Source weights after update. */
  updatedSources: SignalSource[];
}

// ============================================================================
// Configuration
// ============================================================================

export interface MetaWeightingConfig {
  /** Minimum weight any source can have. Default 0.3. */
  minWeight: number;
  /** Maximum weight any source can have. Default 2.5. */
  maxWeight: number;
  /** Daily boost for top quartile performers. Default 1.05 (5%). */
  topQuartileBoost: number;
  /** Daily penalty for bottom quartile. Default 0.95 (5%). */
  bottomQuartilePenalty: number;
  /** Weight differential threshold for regime signal. Default 0.15 (15%). */
  regimeThreshold: number;
  /** Lookback cutoff: sources with lookback <= this are "short-term". Default 20 days. */
  shortTermCutoff: number;
  /** Disagreement penalty factor. Default 0.5. */
  disagreementPenalty: number;
}

export const DEFAULT_META_WEIGHTING_CONFIG: MetaWeightingConfig = {
  minWeight: 0.3,
  maxWeight: 2.5,
  topQuartileBoost: 1.05,
  bottomQuartilePenalty: 0.95,
  regimeThreshold: 0.15,
  shortTermCutoff: 20,
  disagreementPenalty: 0.5,
};

// ============================================================================
// Weight Update (Darwinian)
// ============================================================================

/**
 * Update source weights based on recent performance.
 * Top quartile: boost. Bottom quartile: penalize.
 */
export function updateWeights(
  sources: SignalSource[],
  config: MetaWeightingConfig = DEFAULT_META_WEIGHTING_CONFIG,
): SignalSource[] {
  if (sources.length < 4) return sources;

  const sorted = [...sources].sort((a, b) => b.rollingSharpe - a.rollingSharpe);
  const q1Cutoff = Math.ceil(sorted.length * 0.25);
  const q4Cutoff = Math.floor(sorted.length * 0.75);

  const topIds = new Set(sorted.slice(0, q1Cutoff).map((s) => s.id));
  const bottomIds = new Set(sorted.slice(q4Cutoff).map((s) => s.id));

  return sources.map((source) => {
    let newWeight = source.weight;

    if (topIds.has(source.id)) {
      newWeight = Math.min(config.maxWeight, source.weight * config.topQuartileBoost);
    } else if (bottomIds.has(source.id)) {
      newWeight = Math.max(config.minWeight, source.weight * config.bottomQuartilePenalty);
    }

    return { ...source, weight: newWeight };
  });
}

// ============================================================================
// Emergent Regime Detection
// ============================================================================

/**
 * Detect regime from weight differential between short-term and long-term sources.
 * No explicit regime classifier needed — the weights ARE the signal.
 */
export function detectEmergentRegime(
  sources: SignalSource[],
  config: MetaWeightingConfig = DEFAULT_META_WEIGHTING_CONFIG,
): { regime: EmergentRegime; signalStrength: number } {
  const shortTerm = sources.filter((s) => s.lookbackDays <= config.shortTermCutoff);
  const longTerm = sources.filter((s) => s.lookbackDays > config.shortTermCutoff);

  if (shortTerm.length === 0 || longTerm.length === 0) {
    return { regime: "mixed", signalStrength: 0 };
  }

  const avgShortWeight = shortTerm.reduce((s, src) => s + src.weight, 0) / shortTerm.length;
  const avgLongWeight = longTerm.reduce((s, src) => s + src.weight, 0) / longTerm.length;

  const differential = (avgShortWeight - avgLongWeight) / ((avgShortWeight + avgLongWeight) / 2);

  if (differential > config.regimeThreshold) {
    return { regime: "novel_regime", signalStrength: differential };
  }
  if (differential < -config.regimeThreshold) {
    return { regime: "historical_regime", signalStrength: Math.abs(differential) };
  }
  return { regime: "mixed", signalStrength: Math.abs(differential) };
}

// ============================================================================
// Recommendation Blending
// ============================================================================

/**
 * Blend predictions from multiple weighted sources into final recommendations.
 */
export function blendRecommendations(
  predictions: WeightedPrediction[],
  config: MetaWeightingConfig = DEFAULT_META_WEIGHTING_CONFIG,
): BlendedRecommendation[] {
  // Group by symbol
  const bySymbol = new Map<string, WeightedPrediction[]>();
  for (const pred of predictions) {
    const list = bySymbol.get(pred.symbol) ?? [];
    list.push(pred);
    bySymbol.set(pred.symbol, list);
  }

  const recommendations: BlendedRecommendation[] = [];

  for (const [symbol, preds] of bySymbol) {
    const longConviction = preds
      .filter((p) => p.direction === "long")
      .reduce((s, p) => s + p.weightedConviction, 0);

    const shortConviction = preds
      .filter((p) => p.direction === "short")
      .reduce((s, p) => s + p.weightedConviction, 0);

    const contested = longConviction > 0 && shortConviction > 0;
    const penalty = contested
      ? Math.min(longConviction, shortConviction) * config.disagreementPenalty
      : 0;

    let direction: BlendedRecommendation["direction"];
    let finalConviction: number;

    if (longConviction > shortConviction) {
      direction = "long";
      finalConviction = longConviction - penalty;
    } else if (shortConviction > longConviction) {
      direction = "short";
      finalConviction = shortConviction - penalty;
    } else {
      direction = "neutral";
      finalConviction = 0;
    }

    recommendations.push({
      symbol,
      direction,
      finalConviction: Math.max(0, finalConviction),
      contested,
      disagreementPenalty: penalty,
      contributors: preds.map((p) => ({
        sourceId: p.sourceId,
        direction: p.direction,
        weightedConviction: p.weightedConviction,
      })),
    });
  }

  return recommendations.sort((a, b) => b.finalConviction - a.finalConviction);
}

/**
 * Run full meta-weighting cycle: update weights → detect regime → blend.
 */
export function runMetaWeighting(
  sources: SignalSource[],
  predictions: WeightedPrediction[],
  config: MetaWeightingConfig = DEFAULT_META_WEIGHTING_CONFIG,
): MetaWeightingResult {
  const updatedSources = updateWeights(sources, config);
  const { regime, signalStrength } = detectEmergentRegime(updatedSources, config);
  const recommendations = blendRecommendations(predictions, config);

  return {
    recommendations,
    regime,
    regimeSignalStrength: signalStrength,
    updatedSources,
  };
}
