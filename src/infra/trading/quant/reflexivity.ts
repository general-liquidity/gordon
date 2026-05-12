/**
 * Reflexivity Engine — Soros's Theory in Code
 *
 * Markets don't just reflect reality — they CHANGE it through feedback loops.
 * This module models 5 feedback loops and detects reflexive extremes where
 * a reversal becomes probable.
 *
 * Proven live: Atlas GIC ran this for 378 trading days. First detection:
 * Gold bullish consensus in 4 of 5 simulation rounds → flagged 32% reversal.
 *
 * 5 Feedback Loops:
 *   1. Price → Fundamentals (price changes cause fundamental changes)
 *   2. P&L → Behaviour (drawdowns cause forced selling, gains cause overconfidence)
 *   3. Narrative → Flows (analyst consensus drives retail money)
 *   4. Market → Policy (equity drops trigger central bank response)
 *   5. Reflexive Reversal (feedback running 5+ rounds → exhaustion)
 *
 * Source: Atlas GIC (General Intelligence Capital)
 */

// ============================================================================
// Types
// ============================================================================

export type FeedbackLoopType =
  | "price_fundamentals"
  | "pnl_behaviour"
  | "narrative_flows"
  | "market_policy"
  | "reflexive_reversal";

export interface FeedbackSignal {
  loop: FeedbackLoopType;
  direction: "reinforcing" | "stabilizing";
  strength: number; // 0-100
  description: string;
  /** How many consecutive rounds this loop has been active in the same direction. */
  consecutiveRounds: number;
}

export interface ReflexivityAssessment {
  /** All active feedback loops. */
  activeLoops: FeedbackSignal[];
  /** Number of loops reinforcing in the same direction. */
  reinforcingCount: number;
  /** Whether a reflexive extreme is detected. */
  reflexiveExtreme: boolean;
  /** Probability of reversal (0-1). Higher when extreme detected. */
  reversalProbability: number;
  /** Overall reflexivity score (0-100). High = strong feedback effects. */
  reflexivityScore: number;
  /** Direction of the dominant feedback. */
  dominantDirection: "bullish" | "bearish" | "mixed";
  /** Summary. */
  summary: string;
}

export interface ReflexivityInputs {
  /** Recent price change % (e.g., -0.15 = 15% drop). */
  priceChangePct: number;
  /** Over how many days. */
  priceChangeDays: number;
  /** Current P&L of the portfolio or position (%). */
  portfolioPnlPct: number;
  /** Number of analysts with same directional bias (0-10). */
  analystConsensus: number;
  /** Total analysts surveyed. */
  totalAnalysts: number;
  /** Direction of consensus (if any). */
  consensusDirection?: "bullish" | "bearish";
  /** Current VIX or equivalent vol index. */
  vixLevel?: number;
  /** Whether central bank has signaled policy change recently. */
  centralBankSignal?: "easing" | "tightening" | "neutral";
  /** How many consecutive periods the feedback has been running. */
  feedbackRounds?: number;
}

// ============================================================================
// Feedback Loop Detectors
// ============================================================================

function detectPriceFundamentals(inputs: ReflexivityInputs): FeedbackSignal | null {
  const { priceChangePct } = inputs;

  // Large price drops cause fundamental deterioration
  if (priceChangePct < -0.15) {
    return {
      loop: "price_fundamentals",
      direction: "reinforcing",
      strength: Math.min(100, Math.abs(priceChangePct) * 300),
      description: `Price drop of ${(priceChangePct * 100).toFixed(0)}% may trigger credit downgrades, talent flight, capex cuts — further weakening fundamentals.`,
      consecutiveRounds: inputs.feedbackRounds ?? 1,
    };
  }

  // Large price rises create virtuous cycle
  if (priceChangePct > 0.20) {
    return {
      loop: "price_fundamentals",
      direction: "reinforcing",
      strength: Math.min(100, priceChangePct * 250),
      description: `Price rise of +${(priceChangePct * 100).toFixed(0)}% enables cheap capital raises, attracts talent, boosts customer confidence — strengthening fundamentals.`,
      consecutiveRounds: inputs.feedbackRounds ?? 1,
    };
  }

  return null;
}

function detectPnlBehaviour(inputs: ReflexivityInputs): FeedbackSignal | null {
  const { portfolioPnlPct } = inputs;

  // Portfolio drawdown causes forced selling
  if (portfolioPnlPct < -0.10) {
    return {
      loop: "pnl_behaviour",
      direction: "reinforcing",
      strength: Math.min(100, Math.abs(portfolioPnlPct) * 400),
      description: `Portfolio down ${(portfolioPnlPct * 100).toFixed(0)}% — margin calls and forced selling cascade likely. Others in same position amplify the move.`,
      consecutiveRounds: inputs.feedbackRounds ?? 1,
    };
  }

  // Large gains cause overconfidence and increased risk-taking
  if (portfolioPnlPct > 0.15) {
    return {
      loop: "pnl_behaviour",
      direction: "reinforcing",
      strength: Math.min(100, portfolioPnlPct * 300),
      description: `Portfolio up +${(portfolioPnlPct * 100).toFixed(0)}% — overconfidence and increased position sizes create vulnerability to reversal.`,
      consecutiveRounds: inputs.feedbackRounds ?? 1,
    };
  }

  return null;
}

function detectNarrativeFlows(inputs: ReflexivityInputs): FeedbackSignal | null {
  const { analystConsensus, totalAnalysts, consensusDirection } = inputs;
  if (!totalAnalysts || totalAnalysts < 3) return null;

  const consensusRatio = analystConsensus / totalAnalysts;

  // Strong consensus (>60%) drives retail flows in same direction
  if (consensusRatio > 0.6 && consensusDirection) {
    return {
      loop: "narrative_flows",
      direction: "reinforcing",
      strength: Math.min(100, consensusRatio * 120),
      description: `${(consensusRatio * 100).toFixed(0)}% analyst consensus ${consensusDirection} — retail flow follows narrative, amplifying the move.`,
      consecutiveRounds: inputs.feedbackRounds ?? 1,
    };
  }

  return null;
}

function detectMarketPolicy(inputs: ReflexivityInputs): FeedbackSignal | null {
  const { priceChangePct, vixLevel, centralBankSignal } = inputs;

  // Equity crash triggers policy response
  if (priceChangePct < -0.15 && (vixLevel === undefined || vixLevel > 25)) {
    const hasSignal = centralBankSignal === "easing";
    return {
      loop: "market_policy",
      direction: hasSignal ? "stabilizing" : "reinforcing",
      strength: hasSignal ? 70 : 50,
      description: hasSignal
        ? `Market drop triggering central bank easing — stabilizing feedback may support prices.`
        : `Market drop of ${(priceChangePct * 100).toFixed(0)}% with VIX elevated — policy response likely but not yet signaled.`,
      consecutiveRounds: inputs.feedbackRounds ?? 1,
    };
  }

  return null;
}

function detectReflexiveReversal(activeLoops: FeedbackSignal[]): FeedbackSignal | null {
  // Count reinforcing loops running in the same direction for 5+ rounds
  const prolonged = activeLoops.filter(
    (l) => l.direction === "reinforcing" && l.consecutiveRounds >= 5,
  );

  if (prolonged.length >= 2) {
    const avgStrength = prolonged.reduce((s, l) => s + l.strength, 0) / prolonged.length;
    return {
      loop: "reflexive_reversal",
      direction: "stabilizing", // Reversal is a stabilizing force
      strength: avgStrength,
      description: `${prolonged.length} feedback loops running ${prolonged[0]!.consecutiveRounds}+ rounds in same direction — reflexive exhaustion likely. Reversal probability elevated.`,
      consecutiveRounds: Math.max(...prolonged.map((l) => l.consecutiveRounds)),
    };
  }

  return null;
}

// ============================================================================
// Main Assessment
// ============================================================================

/**
 * Run reflexivity assessment on current market conditions.
 */
export function assessReflexivity(inputs: ReflexivityInputs): ReflexivityAssessment {
  const activeLoops: FeedbackSignal[] = [];

  // Run all 4 primary detectors
  const pf = detectPriceFundamentals(inputs);
  if (pf) activeLoops.push(pf);

  const pb = detectPnlBehaviour(inputs);
  if (pb) activeLoops.push(pb);

  const nf = detectNarrativeFlows(inputs);
  if (nf) activeLoops.push(nf);

  const mp = detectMarketPolicy(inputs);
  if (mp) activeLoops.push(mp);

  // Run reflexive reversal detector on the active loops
  const rr = detectReflexiveReversal(activeLoops);
  if (rr) activeLoops.push(rr);

  // Count reinforcing loops
  const reinforcingCount = activeLoops.filter((l) => l.direction === "reinforcing").length;

  // Determine dominant direction
  const bullishStrength = activeLoops
    .filter((l) => l.description.includes("rise") || l.description.includes("up") || l.description.includes("bullish"))
    .reduce((s, l) => s + l.strength, 0);
  const bearishStrength = activeLoops
    .filter((l) => l.description.includes("drop") || l.description.includes("down") || l.description.includes("bearish"))
    .reduce((s, l) => s + l.strength, 0);

  const dominantDirection: ReflexivityAssessment["dominantDirection"] =
    bullishStrength > bearishStrength * 1.3 ? "bullish" :
    bearishStrength > bullishStrength * 1.3 ? "bearish" :
    "mixed";

  // Reflexive extreme detection
  const reflexiveExtreme = rr !== null;

  // Reversal probability
  let reversalProbability = 0;
  if (reflexiveExtreme) {
    const rounds = rr!.consecutiveRounds;
    // Probability increases with rounds: 5→20%, 7→32%, 10→50%
    reversalProbability = Math.min(0.6, 0.04 * rounds * rounds * 0.01 + 0.15);
  }

  // Overall score
  const reflexivityScore = Math.min(100,
    activeLoops.reduce((s, l) => s + l.strength * (l.direction === "reinforcing" ? 1.2 : 0.8), 0) / Math.max(1, activeLoops.length),
  );

  // Summary
  const parts: string[] = [];
  if (activeLoops.length === 0) {
    parts.push("No active feedback loops detected. Markets appear to be trading on fundamentals.");
  } else {
    parts.push(`${activeLoops.length} feedback loop(s) active, ${reinforcingCount} reinforcing.`);
    if (reflexiveExtreme) {
      parts.push(`REFLEXIVE EXTREME: ${(reversalProbability * 100).toFixed(0)}% reversal probability.`);
    }
    parts.push(`Dominant direction: ${dominantDirection}. Reflexivity score: ${reflexivityScore.toFixed(0)}/100.`);
  }

  return {
    activeLoops,
    reinforcingCount,
    reflexiveExtreme,
    reversalProbability,
    reflexivityScore,
    dominantDirection,
    summary: parts.join(" "),
  };
}
