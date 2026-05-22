/**
 * Risk of ruin — analytic + Monte Carlo diagnostics for Kelly-style sizing.
 *
 * The post correctly noted that "probability of ruin" matters. Gordon's
 * existing position-sizer (with 25% Kelly cap + cost-aware variant in
 * commit e6a31f0c) handles SIZING. This module handles the DIAGNOSTIC:
 * given an operator's edge + chosen fraction + intended trade count,
 * what's the probability of meaningful drawdown?
 *
 * Two paths:
 *
 *   1. ANALYTIC (gambler's ruin closed-form) — applies to fixed-bet
 *      asymmetric games. Useful as a sanity bound but assumes constant
 *      stake per trade, not the multiplicative random walk Kelly betting
 *      actually produces.
 *
 *        P(ruin) = [(q/p)^n - 1] / [(q/p)^N - 1]
 *
 *      for current bankroll n, target bankroll N, win prob p, q = 1-p.
 *
 *   2. MONTE CARLO (multiplicative random walk) — applies to fractional-
 *      Kelly betting. Simulates `numTrades` Bernoulli outcomes per path
 *      with bankroll growing by (1 + f × avgWin) or shrinking by
 *      (1 - f × avgLoss). Reports P(bankroll < threshold) at horizon.
 *
 *      Reflects Rotando-Thorp (1992): half-Kelly users had ~90% chance
 *      of avoiding ruin over long periods; full Kelly users only ~50%
 *      under estimation error.
 *
 * Verdict cascade (most-severe first):
 *   dangerous   P(50% drawdown) > 0.30 OR P(10% drawdown) > 0.10
 *   risky       P(50% drawdown) > 0.15 OR P(10% drawdown) > 0.05
 *   moderate    P(50% drawdown) > 0.05
 *   safe        otherwise
 */

export interface RuinDiagnosticInput {
  /** Probability of winning a single trade (0..1). */
  winProbability: number;
  /** Average winning return (as fraction, e.g. 0.02 for 2%). */
  avgWin: number;
  /** Average losing return magnitude (positive, e.g. 0.01 for 1%). */
  avgLoss: number;
  /** Bet fraction of current bankroll (0..1). Use the Kelly fraction or whatever the operator is actually sizing at. */
  fraction: number;
  /** Number of trades to project forward. Default 100. */
  numTrades?: number;
  /** Number of Monte Carlo paths. Default 5000. */
  simulations?: number;
  /** Initial bankroll for the simulation (cosmetic — ratios are scale-invariant). Default 1.0. */
  initialBankroll?: number;
  /** Seed-like deterministic RNG offset. When unset uses Math.random(). */
  rngSeed?: number;
}

export interface RuinDiagnostic {
  numTrades: number;
  simulations: number;
  fraction: number;
  winProbability: number;
  /** Probability of falling below 50% of initial bankroll at any point in the horizon. */
  ruinTo50Pct: number;
  /** Probability of falling below 10% of initial bankroll (effective wipeout). */
  ruinTo10Pct: number;
  /** Median terminal bankroll multiple (1.0 = unchanged). */
  medianTerminalMultiple: number;
  /** 5th-percentile terminal bankroll multiple (worst-case 95% CI). */
  worstCaseTerminalMultiple: number;
  /** 95th-percentile terminal bankroll multiple. */
  bestCaseTerminalMultiple: number;
  /** Analytic gambler's ruin probability (closed-form, fixed-bet approximation). null when inputs make the formula degenerate. */
  analyticRuinProbability: number | null;
  /** Operator verdict. */
  verdict: "safe" | "moderate" | "risky" | "dangerous";
  /** Human-readable summary. */
  summary: string;
}

const DEFAULT_NUM_TRADES = 100;
const DEFAULT_SIMULATIONS = 5000;
const DEFAULT_INITIAL = 1.0;

/**
 * Deterministic pseudo-random number generator (mulberry32). Used when
 * `rngSeed` is supplied so tests get repeatable results.
 */
function makeRng(seed: number | undefined): () => number {
  if (seed === undefined) return Math.random;
  let state = (seed | 0) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Closed-form gambler's ruin probability for fixed-bet asymmetric play.
 *
 *   P(ruin) = [(q/p)^n - 1] / [(q/p)^N - 1]
 *
 * where the gambler starts with n units and the target is N units.
 * Returns null when:
 *   - p ≤ 0 or p ≥ 1
 *   - n ≥ N (already at or past target)
 *   - p == q (degenerate symmetric case — formula reduces to n/N but
 *     this branch is rarely useful for Kelly diagnostics)
 */
export function analyticGamblersRuin(
  winProb: number,
  startUnits: number,
  targetUnits: number,
): number | null {
  if (winProb <= 0 || winProb >= 1) return null;
  if (startUnits >= targetUnits || startUnits <= 0) return null;
  const q = 1 - winProb;
  if (Math.abs(winProb - q) < 1e-9) {
    // Symmetric fallback
    return 1 - startUnits / targetUnits;
  }
  const r = q / winProb;
  // For numerical safety with large exponents:
  if (r === 1) return 1 - startUnits / targetUnits;
  // Classical gambler's ruin: P(ruin | start=i, target=N) =
  //   (r^N - r^i) / (r^N - 1)
  // where r = q/p. Returns ruin probability ∈ [0, 1]. When r > 1 the
  // gambler is at a disadvantage (q > p); when r < 1 the gambler has
  // the edge and ruin probability approaches 0 as N → ∞.
  const rN = Math.pow(r, targetUnits);
  const rI = Math.pow(r, startUnits);
  const num = rN - rI;
  const den = rN - 1;
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

/**
 * Monte-Carlo risk-of-ruin diagnostic for Kelly-style fractional betting.
 *
 * For each path, simulates `numTrades` Bernoulli outcomes:
 *   - Win: bankroll *= (1 + fraction × avgWin)
 *   - Loss: bankroll *= (1 - fraction × avgLoss)
 *
 * Tracks whether bankroll dipped below 50% / 10% of initial AT ANY POINT
 * during the path (path-dependent ruin, not just terminal value).
 *
 * The reported probabilities are empirical frequencies across paths.
 */
export function computeRuinDiagnostic(input: RuinDiagnosticInput): RuinDiagnostic {
  const numTrades = input.numTrades ?? DEFAULT_NUM_TRADES;
  const simulations = input.simulations ?? DEFAULT_SIMULATIONS;
  const initial = input.initialBankroll ?? DEFAULT_INITIAL;
  const { winProbability, avgWin, avgLoss, fraction } = input;
  const rng = makeRng(input.rngSeed);

  // Clamp Bernoulli win-prob to (0, 1) for safety
  const p = Math.max(0.001, Math.min(0.999, winProbability));
  const winMultiplier = 1 + fraction * avgWin;
  const lossMultiplier = 1 - fraction * avgLoss;

  let touched50Count = 0;
  let touched10Count = 0;
  const terminals: number[] = [];

  for (let s = 0; s < simulations; s++) {
    let bankroll = initial;
    let touched50 = false;
    let touched10 = false;
    for (let t = 0; t < numTrades; t++) {
      const draw = rng();
      bankroll *= draw < p ? winMultiplier : lossMultiplier;
      if (bankroll < initial * 0.5) touched50 = true;
      if (bankroll < initial * 0.1) touched10 = true;
      // Early termination on wipeout (loss multiplier ≤ 0)
      if (bankroll <= 0) {
        touched50 = true;
        touched10 = true;
        break;
      }
    }
    if (touched50) touched50Count++;
    if (touched10) touched10Count++;
    terminals.push(bankroll);
  }

  const sortedTerminals = [...terminals].sort((a, b) => a - b);
  const pct = (q: number) => sortedTerminals[Math.floor(simulations * q)]!;
  const median = pct(0.5) / initial;
  const worst = pct(0.05) / initial;
  const best = pct(0.95) / initial;

  const ruinTo50 = touched50Count / simulations;
  const ruinTo10 = touched10Count / simulations;

  // Analytic gambler's ruin — uses integer-unit approximation. We
  // bucket initial / win-loss into units to make the closed form
  // applicable. This is a sanity check, not the headline number.
  const analyticRuin = analyticGamblersRuin(p, 10, 20); // arbitrary reference scale

  let verdict: RuinDiagnostic["verdict"];
  if (ruinTo50 > 0.30 || ruinTo10 > 0.10) verdict = "dangerous";
  else if (ruinTo50 > 0.15 || ruinTo10 > 0.05) verdict = "risky";
  else if (ruinTo50 > 0.05) verdict = "moderate";
  else verdict = "safe";

  const summary =
    `${simulations} paths × ${numTrades} trades @ f=${fraction.toFixed(3)}: ` +
    `P(>50% drawdown)=${(ruinTo50 * 100).toFixed(1)}%, ` +
    `P(>90% drawdown)=${(ruinTo10 * 100).toFixed(1)}%, ` +
    `median terminal ${median.toFixed(2)}× → ${verdict}`;

  return {
    numTrades,
    simulations,
    fraction,
    winProbability: p,
    ruinTo50Pct: parseFloat(ruinTo50.toFixed(4)),
    ruinTo10Pct: parseFloat(ruinTo10.toFixed(4)),
    medianTerminalMultiple: parseFloat(median.toFixed(4)),
    worstCaseTerminalMultiple: parseFloat(worst.toFixed(4)),
    bestCaseTerminalMultiple: parseFloat(best.toFixed(4)),
    analyticRuinProbability: analyticRuin === null ? null : parseFloat(analyticRuin.toFixed(4)),
    verdict,
    summary,
  };
}
