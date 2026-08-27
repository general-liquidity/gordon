/**
 * Latency-Cost Estimator (Moallemi-style)
 *
 * Quantifies the execution-quality cost of trading at a given latency,
 * as a function of asset volatility + bid-ask spread + latency + trade
 * horizon. From Moallemi's stochastic-control model: the cost of
 * latency scales with volatility (higher vol → stale prices stray
 * further) and the spread (it's the unit you're paying it in).
 *
 * The headline operator-facing answer: for retail, commissions DWARF
 * latency cost. Moallemi's calibration: ~20 mills/share at 500ms
 * latency drops to ~1-2 mills at 1ms. Same order of magnitude as HFT
 * profits + algo execution fees. For a retail operator paying $10
 * commission per trade, latency cost is orders of magnitude smaller
 * than the commission and almost never material.
 *
 * This primitive lets the operator MECHANICALLY verify that claim for
 * their specific (asset, latency, commission) configuration rather
 * than waving hands. Composes with Gordon's positioning above the
 * latency tier (per the Brodsky/Virtu data in the Budish memory).
 *
 * Distinct from:
 *   - `venueMevExposure.ts`         (sniping-tax-from-LOB-market-design)
 *   - `adverseSelectionDetector.ts` (per-fill toxic-flow classification)
 *   - `auctionWindow.ts`            (deferral-to-batch-auction)
 *
 * Pure function. No I/O.
 *
 * Calibration formula (simplified from Moallemi/Crampton/Shim style):
 *
 *   latencyCostPerShare ≈ k × σ × √(latencyMs / horizonMs) × spread
 *
 * where k is a model-dependent constant (defaults to 1.0). This is a
 * rule-of-thumb estimator, NOT a precise replication of the academic
 * model. The intent is to give operators an order-of-magnitude answer
 * for the "should I care about my latency?" question.
 */

export interface LatencyCostInput {
  /** Annualized volatility of the asset, as decimal (0.30 = 30%). */
  annualizedVolatility: number;
  /** Bid-ask spread in price units (e.g. $0.01 = 1 cent). */
  bidAskSpread: number;
  /** Latency in milliseconds (operator's end-to-end delay). */
  latencyMs: number;
  /** Time horizon of the trade in seconds (e.g. 10 = 10s execution). */
  timeHorizonSeconds: number;
  /** Optional: commission per share in price units for comparison. */
  commissionPerShare?: number;
  /**
   * Optional model scaling constant. Default 1.0. Operators can
   * calibrate against observed latency-cost data.
   */
  scalingConstant?: number;
}

export type LatencyCostVerdict = "negligible" | "marginal" | "material" | "dominant";

export interface LatencyCostResult {
  /** Estimated latency cost per share in price units. */
  latencyCostPerShare: number;
  /** As a fraction of the bid-ask spread. */
  latencyCostAsFractionOfSpread: number;
  /** As a fraction of commission (when supplied). null if no commission. */
  latencyCostAsFractionOfCommission: number | null;
  /** Volatility-adjusted price drift in latency window (in price units). */
  expectedDriftPerLatencyWindow: number;
  verdict: LatencyCostVerdict;
  summary: string;
}

const TRADING_SECONDS_PER_YEAR = 252 * 6.5 * 3600; // ~5.9M seconds
const DEFAULT_SCALING_CONSTANT = 1.0;

function classifyVerdict(
  costPerShare: number,
  spread: number,
  commission: number | null,
): LatencyCostVerdict {
  const spreadFraction = spread > 0 ? costPerShare / spread : Infinity;
  if (commission !== null && commission > 0) {
    const commissionFraction = costPerShare / commission;
    if (commissionFraction < 0.01) return "negligible";
    if (commissionFraction < 0.1) return "marginal";
    if (commissionFraction < 0.5) return "material";
    return "dominant";
  }
  // Without commission context, anchor to bid-ask spread:
  if (spreadFraction < 0.05) return "negligible";
  if (spreadFraction < 0.2) return "marginal";
  if (spreadFraction < 0.5) return "material";
  return "dominant";
}

export function estimateLatencyCost(input: LatencyCostInput): LatencyCostResult {
  const k = input.scalingConstant ?? DEFAULT_SCALING_CONSTANT;

  // Convert annualized vol to per-second vol
  const volPerSecond = input.annualizedVolatility / Math.sqrt(TRADING_SECONDS_PER_YEAR);
  // Expected absolute price drift during the latency window
  // (in fraction of current price) — uses sqrt(t) Brownian scaling
  const latencySec = input.latencyMs / 1000;
  const expectedDriftFraction = volPerSecond * Math.sqrt(latencySec);
  // Drift in price units (assumes spread itself is small relative to
  // price — caller can pass spread = 1 cent on a $100 stock and we
  // interpret drift relative to the spread)
  const expectedDrift = expectedDriftFraction;

  // Cost scales with sqrt(latency / horizon) × spread × volatility-driven
  // mispricing intensity. Default constant 1.0 yields the order-of-
  // magnitude that matches Moallemi's calibration headline.
  const horizonMs = Math.max(1, input.timeHorizonSeconds * 1000);
  const latencyHorizonRatio = Math.sqrt(input.latencyMs / horizonMs);
  const latencyCostPerShare =
    k * input.annualizedVolatility * latencyHorizonRatio * input.bidAskSpread;

  const spreadFraction = input.bidAskSpread > 0 ? latencyCostPerShare / input.bidAskSpread : 0;
  const commissionFraction =
    input.commissionPerShare !== undefined && input.commissionPerShare > 0
      ? latencyCostPerShare / input.commissionPerShare
      : null;

  const verdict = classifyVerdict(
    latencyCostPerShare,
    input.bidAskSpread,
    input.commissionPerShare ?? null,
  );

  const summary =
    `Latency cost ≈ ${latencyCostPerShare.toFixed(6)} per share ` +
    `(${(spreadFraction * 100).toFixed(1)}% of bid-ask spread${
      commissionFraction !== null ? `, ${(commissionFraction * 100).toFixed(1)}% of commission` : ""
    }). ` +
    `σ=${(input.annualizedVolatility * 100).toFixed(0)}%, ` +
    `spread=${input.bidAskSpread.toFixed(4)}, ` +
    `latency=${input.latencyMs}ms, ` +
    `horizon=${input.timeHorizonSeconds}s → ${verdict}.`;

  return {
    latencyCostPerShare: parseFloat(latencyCostPerShare.toFixed(8)),
    latencyCostAsFractionOfSpread: parseFloat(spreadFraction.toFixed(6)),
    latencyCostAsFractionOfCommission:
      commissionFraction === null ? null : parseFloat(commissionFraction.toFixed(6)),
    expectedDriftPerLatencyWindow: parseFloat(expectedDrift.toFixed(8)),
    verdict,
    summary,
  };
}

export function formatLatencyCost(result: LatencyCostResult): string {
  const lines = [
    `Latency Cost — ${result.verdict.toUpperCase()}`,
    "",
    `  Per-share cost: ${result.latencyCostPerShare.toExponential(3)}`,
    `  As fraction of spread: ${(result.latencyCostAsFractionOfSpread * 100).toFixed(2)}%`,
  ];
  if (result.latencyCostAsFractionOfCommission !== null) {
    lines.push(
      `  As fraction of commission: ${(result.latencyCostAsFractionOfCommission * 100).toFixed(2)}%`,
    );
  }
  lines.push(
    `  Expected drift in latency window: ${result.expectedDriftPerLatencyWindow.toExponential(3)}`,
  );
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  if (result.verdict === "negligible") {
    lines.push("");
    lines.push("→ Latency is not your edge or your problem. Spend cycles on signal quality.");
  } else if (result.verdict === "dominant") {
    lines.push("");
    lines.push("→ Latency dominates execution cost. Consider venue routing / faster path.");
  }
  return lines.join("\n");
}
