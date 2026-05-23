/**
 * Constraint Identifier — EV-Bottleneck Detector
 *
 * Codifies Spicy's "Theory of Constraints" framing for traders: the
 * fastest way to improve is to identify the SINGLE biggest bottleneck
 * in your EV equation and pour all focus into solving it. EV has 4
 * variables — win rate, average win, average loss, trade frequency —
 * and the trader's biggest gap-from-target across those four is the
 * constraint worth attacking.
 *
 * Input:
 *   - current values for each of the 4 EV components
 *   - operator-declared targets for each
 *   - (optional) sample size for confidence weighting
 *
 * Output:
 *   - per-component deficit (current vs target, normalized)
 *   - ranked list of components by deficit magnitude
 *   - dominant constraint + recommended action
 *
 * Caveat: this primitive doesn't tell you HOW to fix the constraint —
 * it tells you WHICH one to attack. Solutions are operator-judgment;
 * Spicy's article lists practical ones (fewer mistakes, tighter stops,
 * wider TPs on A+ setups, more alerts). The recommended-action output
 * names the Spicy-listed lever for that component, but the lever is
 * advisory, not prescriptive.
 *
 * Composes with `expectancy-by-tag` (the report's overall row gives
 * winRate + avgWin + avgLoss directly; frequency comes from sample
 * size / observation window).
 *
 * Pure function. No I/O.
 */

export type EvComponent = "win_rate" | "avg_win" | "avg_loss" | "frequency";

export interface EvComponentTarget {
  current: number;
  target: number;
}

export interface ConstraintIdentifierInput {
  /** Current win rate as a fraction in [0, 1]. */
  winRate: EvComponentTarget;
  /** Average winning trade R-multiple (or $) — positive values. */
  avgWin: EvComponentTarget;
  /** Average losing trade R-multiple (or $) — POSITIVE values (magnitude). */
  avgLoss: EvComponentTarget;
  /** Trade frequency, e.g. trades per unit time. */
  frequency: EvComponentTarget;
  /** Optional sample size used for the current measurements. */
  sampleSize?: number;
  /** Minimum sample size for a confident verdict. Default 30. */
  minSampleSize?: number;
}

export interface ComponentDeficit {
  component: EvComponent;
  current: number;
  target: number;
  /** (target − current) / target. Positive = below target = deficit. */
  normalizedDeficit: number;
  /** Raw absolute gap (target − current). */
  rawGap: number;
  /** Lever name from Spicy's improvement-process article. */
  recommendedLever: string;
  /** True iff current ≥ target on this component. */
  meetsTarget: boolean;
}

export interface ConstraintIdentifierResult {
  components: ComponentDeficit[];
  /** Components ranked by normalizedDeficit (largest first). */
  rankedByDeficit: ComponentDeficit[];
  /** The single largest constraint. Null when all components meet target. */
  dominantConstraint: ComponentDeficit | null;
  /** True when sample size is below minSampleSize threshold. */
  lowConfidence: boolean;
  verdict:
    | "no_constraint"
    | "constraint_identified"
    | "insufficient_data";
  summary: string;
}

const DEFAULT_MIN_SAMPLE_SIZE = 30;

// Spicy's article suggests THIS specific order of attack by ROI/effort:
//   1. fewer mistakes (winrate)
//   2. fewer low-quality trades (winrate)
//   3. cut losers faster on A+ (avg_loss)
//   4. risk more on A+ (avg_win)
//   5. wider TP on A+ (avg_win)
//   6. more/better alerts (frequency)
//   7. add more strategies (frequency)
const LEVER_BY_COMPONENT: Record<EvComponent, string> = {
  win_rate: "Reduce mistakes + filter out low-quality setups (Spicy steps 1-2)",
  avg_loss: "Cut losers faster on A+ setups (Spicy step 3)",
  avg_win: "Risk more on A+ setups and widen TP when conditions support it (Spicy steps 4-5)",
  frequency: "Add alerts / introduce a second strategy to the toolbox (Spicy steps 6-7)",
};

function normalizedDeficit(component: EvComponent, current: number, target: number): number {
  if (target === 0) return current === 0 ? 0 : -Infinity;
  // For avg_loss, target is the MAX acceptable loss magnitude — being
  // ABOVE target is the deficit (you're losing more than you'd like).
  // For the other three, being BELOW target is the deficit.
  if (component === "avg_loss") {
    return (current - target) / Math.abs(target);
  }
  return (target - current) / Math.abs(target);
}

function buildDeficit(
  component: EvComponent,
  data: EvComponentTarget,
): ComponentDeficit {
  const nd = normalizedDeficit(component, data.current, data.target);
  const rawGap =
    component === "avg_loss"
      ? data.current - data.target
      : data.target - data.current;
  return {
    component,
    current: data.current,
    target: data.target,
    normalizedDeficit: parseFloat(nd.toFixed(4)),
    rawGap: parseFloat(rawGap.toFixed(4)),
    recommendedLever: LEVER_BY_COMPONENT[component],
    meetsTarget: nd <= 0,
  };
}

export function identifyConstraint(input: ConstraintIdentifierInput): ConstraintIdentifierResult {
  const minSample = input.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;
  const lowConfidence =
    input.sampleSize !== undefined && input.sampleSize < minSample;

  const components: ComponentDeficit[] = [
    buildDeficit("win_rate", input.winRate),
    buildDeficit("avg_win", input.avgWin),
    buildDeficit("avg_loss", input.avgLoss),
    buildDeficit("frequency", input.frequency),
  ];

  const rankedByDeficit = [...components].sort(
    (a, b) => b.normalizedDeficit - a.normalizedDeficit,
  );

  const allMeet = components.every((c) => c.meetsTarget);
  let verdict: ConstraintIdentifierResult["verdict"];
  let dominantConstraint: ComponentDeficit | null = null;

  if (input.sampleSize !== undefined && input.sampleSize === 0) {
    verdict = "insufficient_data";
  } else if (allMeet) {
    verdict = "no_constraint";
  } else {
    verdict = "constraint_identified";
    dominantConstraint = rankedByDeficit[0]!;
  }

  let summary: string;
  if (verdict === "insufficient_data") {
    summary = "Insufficient data — no trades to analyze.";
  } else if (verdict === "no_constraint") {
    summary =
      "All four EV components meet target — no dominant constraint. " +
      "Focus on consolidating execution and stretching targets gradually.";
  } else {
    const dc = dominantConstraint!;
    const dirWord = dc.component === "avg_loss" ? "above" : "below";
    summary =
      `Dominant constraint: ${dc.component} (${(dc.normalizedDeficit * 100).toFixed(1)}% ${dirWord} target). ` +
      `Current ${dc.current.toFixed(4)}, target ${dc.target.toFixed(4)}. ` +
      `Recommended lever: ${dc.recommendedLever}` +
      (lowConfidence
        ? ` ⚠ Low confidence (sample size ${input.sampleSize} < ${minSample}).`
        : ".");
  }

  return {
    components,
    rankedByDeficit,
    dominantConstraint,
    lowConfidence,
    verdict,
    summary,
  };
}

export function formatConstraint(result: ConstraintIdentifierResult): string {
  const lines = [
    `EV Constraint — ${result.verdict.toUpperCase()}`,
    "",
    "  Component       Current      Target       Normalized deficit",
  ];
  for (const c of result.rankedByDeficit) {
    const meets = c.meetsTarget ? "✓" : "✗";
    lines.push(
      `  ${meets} ${c.component.padEnd(13)} ${c.current.toFixed(4).padStart(10)} ${c.target.toFixed(4).padStart(10)}   ${(c.normalizedDeficit * 100).toFixed(1)}%`,
    );
  }
  lines.push("");
  if (result.lowConfidence) {
    lines.push("  ⚠ Low confidence: small sample size.");
    lines.push("");
  }
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
