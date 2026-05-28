/**
 * Ruin probability — Monte Carlo gambler's-ruin estimate for
 * fixed-fractional position sizing.
 *
 * Given a strategy's empirical win rate + payout ratio + per-trade
 * risk fraction + horizon, simulates N parallel portfolios and
 * counts how many breach a ruin threshold (default 50% drawdown).
 *
 * Distinct from `compute_kelly_size`:
 *   - Kelly returns the OPTIMAL fraction for log-growth.
 *   - Ruin probability quantifies the SURVIVAL risk at a CHOSEN
 *     fraction over a finite horizon. Even a Kelly-optimal sizing
 *     has non-zero ruin probability over a short horizon.
 *
 * Output verdict bands (operationally calibrated, not academic):
 *   - 'safe'     — ruin probability < 1%
 *   - 'cautious' — 1% to 5%
 *   - 'risky'    — 5% to 20%
 *   - 'ruinous'  — > 20%
 *
 * Pure function. Seeded RNG for reproducibility.
 */

export type RuinVerdict = "safe" | "cautious" | "risky" | "ruinous";

export interface RuinProbabilityInput {
  /** Probability of a winning trade (0..1). */
  winProbability: number;
  /** Avg win as a multiple of avg loss. e.g. 2.0 = wins are 2× losses. */
  payoutRatio: number;
  /** Fraction of capital risked per trade (0..1). At 0.01 (1%), a
   *  loss reduces capital by 1%. */
  riskFraction: number;
  /** Number of trades to simulate per portfolio. */
  horizonTrades: number;
  /** Ruin threshold as a fraction of starting capital (0..1). 0.5
   *  means "ruin if capital drops below 50% of start." Default 0.5. */
  ruinThresholdPct?: number;
  /** Monte Carlo trial count. Default 5000. Higher = tighter
   *  estimate of the ruin probability. */
  nTrials?: number;
  /** Optional seed for reproducibility. */
  seed?: number;
}

export interface RuinProbabilityResult {
  /** Fraction of simulated portfolios that breached the ruin
   *  threshold at any point during the horizon. */
  ruinProbability: number;
  /** Median final capital (as a fraction of starting capital). */
  medianFinalCapital: number;
  /** 5th-percentile final capital. */
  p05FinalCapital: number;
  /** 95th-percentile final capital. */
  p95FinalCapital: number;
  /** Expected geometric return per trade (closed-form). */
  expectedLogReturn: number;
  verdict: RuinVerdict;
  nTrials: number;
  horizonTrades: number;
  interpretation: string;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx]!;
}

function classify(p: number): RuinVerdict {
  if (p < 0.01) return "safe";
  if (p < 0.05) return "cautious";
  if (p < 0.20) return "risky";
  return "ruinous";
}

export function computeRuinProbability(input: RuinProbabilityInput): RuinProbabilityResult {
  if (!(input.winProbability >= 0 && input.winProbability <= 1)) {
    throw new Error("ruinProbability: winProbability must be in [0, 1]");
  }
  if (!(input.payoutRatio > 0 && Number.isFinite(input.payoutRatio))) {
    throw new Error("ruinProbability: payoutRatio must be positive finite");
  }
  if (!(input.riskFraction > 0 && input.riskFraction < 1)) {
    throw new Error("ruinProbability: riskFraction must be in (0, 1)");
  }
  if (!Number.isInteger(input.horizonTrades) || input.horizonTrades < 1) {
    throw new Error("ruinProbability: horizonTrades must be a positive integer");
  }
  const ruinThreshold = input.ruinThresholdPct ?? 0.5;
  if (!(ruinThreshold >= 0 && ruinThreshold < 1)) {
    throw new Error("ruinProbability: ruinThresholdPct must be in [0, 1)");
  }
  const nTrials = input.nTrials ?? 5000;
  const rng = input.seed != null ? makeRng(input.seed) : Math.random;

  // Closed-form expected per-trade log return (Kelly-style):
  //   E[log(1 + outcome)] = p × log(1 + r × b) + (1 - p) × log(1 - r)
  const winLog = Math.log(1 + input.riskFraction * input.payoutRatio);
  const lossLog = Math.log(1 - input.riskFraction);
  const expectedLogReturn = input.winProbability * winLog + (1 - input.winProbability) * lossLog;

  // Monte Carlo simulation. Each trial starts at capital=1, runs
  // `horizonTrades` trades, marks itself ruined if capital ever
  // breaches the threshold during the horizon (path-dependent —
  // can't recover from ruin).
  const finalCapitals: number[] = new Array(nTrials);
  let ruinCount = 0;
  for (let t = 0; t < nTrials; t++) {
    let capital = 1;
    let ruined = false;
    for (let i = 0; i < input.horizonTrades; i++) {
      const won = rng() < input.winProbability;
      capital *= won ? 1 + input.riskFraction * input.payoutRatio : 1 - input.riskFraction;
      if (!ruined && capital < ruinThreshold) {
        ruined = true;
        // Don't break — we still want the final-capital distribution.
      }
    }
    finalCapitals[t] = capital;
    if (ruined) ruinCount++;
  }
  const ruinProbability = ruinCount / nTrials;

  // Distribution stats.
  finalCapitals.sort((a, b) => a - b);
  const medianFinalCapital = quantile(finalCapitals, 0.5);
  const p05FinalCapital = quantile(finalCapitals, 0.05);
  const p95FinalCapital = quantile(finalCapitals, 0.95);

  const verdict = classify(ruinProbability);
  const verdictLabel =
    verdict === "safe"
      ? "Safe sizing"
      : verdict === "cautious"
        ? "Cautious — non-trivial ruin probability"
        : verdict === "risky"
          ? "Risky — meaningful chance of ruin"
          : "Ruinous — high probability of breaching threshold";
  const interpretation =
    `${verdictLabel}: ${(ruinProbability * 100).toFixed(2)}% probability of breaching ${(ruinThreshold * 100).toFixed(0)}% drawdown over ${input.horizonTrades} trades. ` +
    `Median final capital ${(medianFinalCapital * 100).toFixed(0)}% of start; p5..p95 [${(p05FinalCapital * 100).toFixed(0)}%, ${(p95FinalCapital * 100).toFixed(0)}%]. ` +
    `Expected per-trade log return: ${(expectedLogReturn * 100).toFixed(2)}% ${expectedLogReturn > 0 ? "(positive edge)" : "(negative edge — strategy is unviable at this sizing)"}.`;

  return {
    ruinProbability,
    medianFinalCapital,
    p05FinalCapital,
    p95FinalCapital,
    expectedLogReturn,
    verdict,
    nTrials,
    horizonTrades: input.horizonTrades,
    interpretation,
  };
}
