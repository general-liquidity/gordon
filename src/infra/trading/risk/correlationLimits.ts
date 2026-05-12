/**
 * Correlation-Adjusted Position Limits
 *
 * Reduces allocation when a new position is highly correlated with
 * existing portfolio holdings. Prevents concentrated systematic risk
 * (e.g., 30% BTC + 30% ETH = effectively 60% one bet at 90% correlation).
 *
 * From AI Hedge Fund: builds correlation matrix, applies multiplier
 * to position limits based on max correlation with existing positions.
 */

// ============================================================================
// Types
// ============================================================================

export interface CorrelationCheck {
  /** Symbol being evaluated. */
  symbol: string;
  /** Max correlation with any existing position. */
  maxCorrelation: number;
  /** Which existing position it's most correlated with. */
  mostCorrelatedWith: string;
  /** Multiplier applied to position limit (1.0 = no reduction, 0.5 = halved). */
  correlationMultiplier: number;
  /** Adjusted allocation after correlation penalty. */
  adjustedAllocationPct: number;
  /** Original allocation before correlation penalty. */
  originalAllocationPct: number;
  /** Whether this position would create concentration risk. */
  concentrationWarning: boolean;
}

// ============================================================================
// Correlation Computation
// ============================================================================

/**
 * Compute Pearson correlation between two return series.
 */
export function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 10) return 0; // Not enough data

  const sliceA = a.slice(-n);
  const sliceB = b.slice(-n);

  const meanA = sliceA.reduce((s, v) => s + v, 0) / n;
  const meanB = sliceB.reduce((s, v) => s + v, 0) / n;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const dA = sliceA[i]! - meanA;
    const dB = sliceB[i]! - meanB;
    cov += dA * dB;
    varA += dA * dA;
    varB += dB * dB;
  }

  const denom = Math.sqrt(varA * varB);
  return denom > 0 ? cov / denom : 0;
}

/**
 * Build a correlation matrix from multiple return series.
 * Returns a map of "symbolA:symbolB" → correlation.
 */
export function buildCorrelationMatrix(
  returnsBySymbol: Record<string, number[]>,
): Map<string, number> {
  const matrix = new Map<string, number>();
  const symbols = Object.keys(returnsBySymbol);

  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const a = symbols[i]!;
      const b = symbols[j]!;
      const corr = pearsonCorrelation(returnsBySymbol[a]!, returnsBySymbol[b]!);
      matrix.set(`${a}:${b}`, corr);
      matrix.set(`${b}:${a}`, corr);
    }
  }

  return matrix;
}

/**
 * Compute correlation multiplier for position limits.
 *
 * AI Hedge Fund approach:
 *   |corr| > 0.8  → 0.5x (halve the limit)
 *   |corr| > 0.6  → 0.7x
 *   |corr| > 0.4  → 0.85x
 *   |corr| <= 0.4 → 1.0x (no adjustment)
 */
export function correlationMultiplier(maxAbsCorrelation: number): number {
  const absCorr = Math.abs(maxAbsCorrelation);
  if (absCorr > 0.8) return 0.5;
  if (absCorr > 0.6) return 0.7;
  if (absCorr > 0.4) return 0.85;
  return 1.0;
}

/**
 * Check a proposed position against existing portfolio for correlation risk.
 *
 * @param newSymbol Symbol to evaluate.
 * @param newReturns Daily returns for the new symbol.
 * @param existingPositions Map of symbol → { returns, weightPct }.
 * @param proposedAllocationPct Proposed allocation before correlation adjustment.
 */
export function checkCorrelationRisk(
  newSymbol: string,
  newReturns: number[],
  existingPositions: Record<string, { returns: number[]; weightPct: number }>,
  proposedAllocationPct: number,
): CorrelationCheck {
  const existing = Object.keys(existingPositions);
  if (existing.length === 0) {
    return {
      symbol: newSymbol,
      maxCorrelation: 0,
      mostCorrelatedWith: "none",
      correlationMultiplier: 1.0,
      adjustedAllocationPct: proposedAllocationPct,
      originalAllocationPct: proposedAllocationPct,
      concentrationWarning: false,
    };
  }

  let maxCorr = 0;
  let mostCorrelatedWith = "";

  for (const [symbol, position] of Object.entries(existingPositions)) {
    const corr = Math.abs(pearsonCorrelation(newReturns, position.returns));
    if (corr > maxCorr) {
      maxCorr = corr;
      mostCorrelatedWith = symbol;
    }
  }

  const multiplier = correlationMultiplier(maxCorr);
  const adjustedAllocationPct = proposedAllocationPct * multiplier;

  // Check combined weight with correlated positions
  const correlatedWeight = mostCorrelatedWith
    ? (existingPositions[mostCorrelatedWith]?.weightPct ?? 0)
    : 0;
  const combinedWeight = correlatedWeight + adjustedAllocationPct;
  const concentrationWarning = combinedWeight > 30 && maxCorr > 0.6;

  return {
    symbol: newSymbol,
    maxCorrelation: maxCorr,
    mostCorrelatedWith,
    correlationMultiplier: multiplier,
    adjustedAllocationPct,
    originalAllocationPct: proposedAllocationPct,
    concentrationWarning,
  };
}
