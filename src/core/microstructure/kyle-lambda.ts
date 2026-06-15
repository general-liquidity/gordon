/**
 * Kyle's lambda — the price-impact coefficient.
 *
 * From Kyle (1985): a market maker who sees only total order flow prices
 * linearly in it, Δp = λ·Q + ε, where Q is the SIGNED order flow over an
 * interval and λ measures how far price moves per unit of flow. λ is the
 * canonical definition of market impact — "every execution algo is built to
 * minimize Kyle's lambda when it trades," and statistical-arb desks run the
 * inverse problem (is this flow information or noise?).
 *
 * Distinct from Amihud illiquidity (`core/indicators/amihud-illiquidity.ts`),
 * which is the UNSIGNED |return|/volume ratio: Amihud is a coarse daily
 * illiquidity proxy; Kyle's λ is the signed regression slope of price change on
 * net order flow — the intraday impact coefficient itself.
 *
 * Estimated as the OLS slope λ = Cov(Δp, Q) / Var(Q), with R² reporting how much
 * of the price variation the flow explains (high R² = price is flow-driven /
 * informed; low R² = price moves are mostly exogenous). Pure — caller supplies
 * the aligned interval series.
 */

export interface KyleLambdaResult {
  /** Price impact per unit signed order flow (OLS slope). */
  lambda: number;
  /** Fraction of price-change variance explained by order flow (0..1). */
  rSquared: number;
  /** Number of intervals used. */
  n: number;
  /** Higher λ + higher R² = a thinner, more informed book. Relative — absolute
   *  λ is instrument/unit specific, so compare it across time or venues. */
  interpretation: string;
}

/**
 * Estimate Kyle's lambda from aligned interval series: `priceChanges[i]` is the
 * mid-price change over interval i, `signedFlows[i]` the net signed volume
 * (buys − sells) over the same interval. Returns null when undeterminable
 * (fewer than 2 points or zero flow variance).
 */
export function computeKyleLambda(
  priceChanges: number[],
  signedFlows: number[],
): KyleLambdaResult | null {
  const n = Math.min(priceChanges.length, signedFlows.length);
  if (n < 2) return null;

  let sumP = 0;
  let sumQ = 0;
  for (let i = 0; i < n; i++) {
    sumP += priceChanges[i]!;
    sumQ += signedFlows[i]!;
  }
  const meanP = sumP / n;
  const meanQ = sumQ / n;

  let covPQ = 0;
  let varQ = 0;
  let varP = 0;
  for (let i = 0; i < n; i++) {
    const dp = priceChanges[i]! - meanP;
    const dq = signedFlows[i]! - meanQ;
    covPQ += dp * dq;
    varQ += dq * dq;
    varP += dp * dp;
  }
  if (varQ <= 0) return null; // no variation in order flow — λ undefined

  const lambda = covPQ / varQ;
  const rSquared = varP > 0 ? (covPQ * covPQ) / (varQ * varP) : 0;

  const interpretation =
    rSquared >= 0.5
      ? `Flow-driven (R²=${rSquared.toFixed(2)}): order flow explains most price moves — informed/thin book, λ=${lambda.toExponential(2)}`
      : rSquared >= 0.2
        ? `Partly flow-driven (R²=${rSquared.toFixed(2)}): λ=${lambda.toExponential(2)}`
        : `Mostly exogenous (R²=${rSquared.toFixed(2)}): price moves aren't well explained by flow — deep/liquid or noisy`;

  return { lambda, rSquared, n, interpretation };
}
