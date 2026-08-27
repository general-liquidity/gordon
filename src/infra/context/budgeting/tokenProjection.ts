/**
 * Token Projection & Proactive Compaction Thresholds
 *
 * Predicts context overflow BEFORE it happens rather than reacting after.
 * Tracks the rate of token growth across recent turns and extrapolates to
 * warn the user at 70%, trigger microcompact at 80%, full compact at 90%.
 *
 * Use alongside RunContext's TokenCounter for anchor data, or pass manual
 * measurements for testing. The projector is stateless — threshold state
 * lives in whatever calls it (typically the orchestrator or RunContext).
 */

export interface ProjectionConfig {
  /** Max context window (tokens) for the current model. */
  contextWindow: number;
  /** Warn user at this fraction of window (default 0.70). */
  warnThreshold: number;
  /** Trigger microcompact at this fraction (default 0.80). */
  microcompactThreshold: number;
  /** Trigger full compact at this fraction (default 0.90). */
  compactThreshold: number;
  /** Max fraction before hard refuse (default 0.97). */
  hardLimit: number;
}

export const DEFAULT_PROJECTION_CONFIG: ProjectionConfig = {
  contextWindow: 200_000,
  warnThreshold: 0.7,
  microcompactThreshold: 0.8,
  compactThreshold: 0.9,
  hardLimit: 0.97,
};

/** One measurement of context size at a point in time. */
export interface TokenSample {
  timestamp: number;
  tokens: number;
  turn: number;
}

export type ThresholdStage = "ok" | "warn" | "microcompact" | "compact" | "hard_limit";

export interface ProjectionResult {
  stage: ThresholdStage;
  currentTokens: number;
  currentFraction: number;
  contextWindow: number;
  /** Estimated tokens after the NEXT turn, based on recent growth rate. */
  projectedTokens?: number;
  /** Estimated turns until the hard limit at current growth rate. */
  turnsUntilLimit?: number;
  /** Growth rate in tokens-per-turn from recent history. */
  growthPerTurn?: number;
  /** Human-readable recommendation for caller. */
  recommendation: string;
}

/**
 * Determine which threshold stage we're in based on current usage.
 */
export function classifyUsage(
  currentTokens: number,
  config: ProjectionConfig = DEFAULT_PROJECTION_CONFIG,
): ThresholdStage {
  const fraction = currentTokens / config.contextWindow;
  if (fraction >= config.hardLimit) return "hard_limit";
  if (fraction >= config.compactThreshold) return "compact";
  if (fraction >= config.microcompactThreshold) return "microcompact";
  if (fraction >= config.warnThreshold) return "warn";
  return "ok";
}

/**
 * Compute growth rate from recent samples (tokens per turn).
 * Uses last K samples to avoid being skewed by ancient history.
 */
export function growthRate(samples: TokenSample[], lookback: number = 5): number {
  if (samples.length < 2) return 0;
  const recent = samples.slice(-Math.max(2, lookback));
  const first = recent[0]!;
  const last = recent[recent.length - 1]!;
  const turnDelta = Math.max(1, last.turn - first.turn);
  const tokenDelta = last.tokens - first.tokens;
  return tokenDelta / turnDelta;
}

/**
 * Build a full projection result from a series of token measurements.
 */
export function projectUsage(
  samples: TokenSample[],
  config: ProjectionConfig = DEFAULT_PROJECTION_CONFIG,
): ProjectionResult {
  const latest = samples[samples.length - 1];
  if (!latest) {
    return {
      stage: "ok",
      currentTokens: 0,
      currentFraction: 0,
      contextWindow: config.contextWindow,
      recommendation: "No measurements yet",
    };
  }

  const stage = classifyUsage(latest.tokens, config);
  const currentFraction = latest.tokens / config.contextWindow;
  const growth = growthRate(samples);

  const projected = latest.tokens + growth;
  const hardLimitTokens = config.contextWindow * config.hardLimit;
  const turnsUntilLimit =
    growth > 0 ? Math.max(0, Math.ceil((hardLimitTokens - latest.tokens) / growth)) : undefined;

  let recommendation: string;
  switch (stage) {
    case "hard_limit":
      recommendation = "HARD LIMIT — halt new tool calls; summarize and return";
      break;
    case "compact":
      recommendation = "Run full LLM-based compaction before the next turn";
      break;
    case "microcompact":
      recommendation = "Run microcompact to trim old tool results";
      break;
    case "warn":
      recommendation =
        turnsUntilLimit !== undefined
          ? `Approaching limit (${Math.round(currentFraction * 100)}%) — ~${turnsUntilLimit} turns to hard cap`
          : `Context at ${Math.round(currentFraction * 100)}% of window`;
      break;
    default:
      recommendation = "Context healthy";
  }

  return {
    stage,
    currentTokens: latest.tokens,
    currentFraction,
    contextWindow: config.contextWindow,
    projectedTokens: projected,
    turnsUntilLimit,
    growthPerTurn: growth > 0 ? growth : undefined,
    recommendation,
  };
}

/**
 * Rolling projector — retains a sample window and exposes current state.
 */
export class TokenProjector {
  private samples: TokenSample[] = [];
  private readonly maxSamples: number;
  private readonly config: ProjectionConfig;

  constructor(config: Partial<ProjectionConfig> = {}, maxSamples: number = 50) {
    this.config = { ...DEFAULT_PROJECTION_CONFIG, ...config };
    this.maxSamples = maxSamples;
  }

  record(tokens: number, turn: number): ProjectionResult {
    this.samples.push({ timestamp: Date.now(), tokens, turn });
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }
    return projectUsage(this.samples, this.config);
  }

  current(): ProjectionResult {
    return projectUsage(this.samples, this.config);
  }

  reset(): void {
    this.samples = [];
  }

  getSamples(): readonly TokenSample[] {
    return this.samples;
  }
}
