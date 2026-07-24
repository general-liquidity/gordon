/**
 * Marginal Participant Classifier (GORDON_MARGINAL_PARTICIPANT).
 *
 * Port of Wright Ch 1 + Ch 7 + Ch 12 — the load-bearing thesis of the
 * book. The marginal participant alternates between two regimes:
 *
 *   typical      — sophisticated HFT / quant. You can't outthink them.
 *   opportunity  — forced/constrained seller (margin call cascade,
 *                  index rebalance, month-end mandate, ETF reconstitution,
 *                  tax-loss selling, sentiment extreme, gamma squeeze).
 *
 * Edge for non-HFT traders comes entirely from identifying when the
 * marginal participant has shifted from unconstrained optimizer to
 * forced seller. Build strategy around their necessity, not your analysis.
 *
 * Composes with `confluenceScorer.ts` — `marginal=opportunity` is a
 * new ConfluenceKind. Composes with `terminationLayers` — when
 * `marginal=typical` and no other edge identified, soft termination
 * signal ("trading into HFT-dominated flow with no observed edge").
 */

export type MarginalState = "typical" | "opportunity" | "uncertain";

export type DriverKind =
  | "index_reconstitution"
  | "month_end_rebalance"
  | "quarter_end_rebalance"
  | "futures_roll"
  | "etf_inclusion"
  | "options_expiry"
  | "tax_loss_selling"
  | "margin_call_cascade"
  | "vix_spike"
  | "correlation_spike"
  | "bid_evaporation"
  | "funding_extreme"
  | "liquidation_cluster"
  | "stablecoin_redemption"
  | "gamma_squeeze";

export interface MarginalParticipantInput {
  /** Drivers currently observed. Each contributes evidence toward opportunity state. */
  drivers: ReadonlyArray<DriverKind>;
  /**
   * Generic noise multipliers when no specific driver is identified.
   * Lower vix + tighter spreads = more typical state. Provided as raw
   * z-scores or normalized fractions vs recent baseline.
   */
  vixZScore?: number;
  correlationZScore?: number;
}

export interface MarginalParticipantResult {
  marginal: MarginalState;
  drivers: DriverKind[];
  confidence: number;
  reasoning: string;
}

const CALENDAR_DRIVERS: ReadonlySet<DriverKind> = new Set([
  "index_reconstitution",
  "month_end_rebalance",
  "quarter_end_rebalance",
  "futures_roll",
  "etf_inclusion",
  "options_expiry",
  "tax_loss_selling",
]);

const STRESS_DRIVERS: ReadonlySet<DriverKind> = new Set([
  "margin_call_cascade",
  "vix_spike",
  "correlation_spike",
  "bid_evaporation",
  "funding_extreme",
  "liquidation_cluster",
  "stablecoin_redemption",
  "gamma_squeeze",
]);

export function classifyMarginalParticipant(
  input: MarginalParticipantInput,
): MarginalParticipantResult {
  const drivers = [...new Set(input.drivers)];
  let opportunityScore = 0;
  for (const d of drivers) {
    if (CALENDAR_DRIVERS.has(d)) opportunityScore += 1;
    if (STRESS_DRIVERS.has(d)) opportunityScore += 2;
  }
  const vixZ = input.vixZScore ?? 0;
  const corrZ = input.correlationZScore ?? 0;
  if (vixZ > 2) opportunityScore += 1;
  if (corrZ > 2) opportunityScore += 1;

  let marginal: MarginalState;
  let confidence: number;
  let reasoning: string;

  if (opportunityScore >= 3) {
    marginal = "opportunity";
    confidence = Math.min(1, 0.5 + opportunityScore * 0.1);
    reasoning = `Forced flow detected: ${drivers.join(", ") || "stress markers"}`;
  } else if (opportunityScore >= 1) {
    marginal = "uncertain";
    confidence = 0.4 + opportunityScore * 0.1;
    reasoning = `Partial forced-flow signal — not enough to override default typical state`;
  } else if (vixZ < -1 && corrZ < -1) {
    marginal = "typical";
    confidence = 0.7;
    reasoning = `Calm market, low cross-asset correlation — HFT-dominated flow`;
  } else {
    marginal = "typical";
    confidence = 0.5;
    reasoning = `No forced-flow drivers identified — default to typical (HFT-dominated)`;
  }

  return { marginal, drivers, confidence, reasoning };
}

export function marginalToPayload(result: MarginalParticipantResult): Record<string, unknown> {
  return {
    kind: "marginal_participant.classified",
    marginal: result.marginal,
    driverCount: result.drivers.length,
    confidence: Number(result.confidence.toFixed(3)),
  };
}
