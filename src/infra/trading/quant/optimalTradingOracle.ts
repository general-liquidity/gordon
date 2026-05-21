/**
 * Optimal Trading Oracle (GORDON_OPTIMAL_TRADING_ORACLE).
 *
 * Computes the ex-post counterfactually-perfect trade sequence for a given
 * return path. The oracle has perfect foreknowledge of every return r_t and
 * picks the position h_t ∈ {-L, 0, +L} that maximises cumulative net profit
 * subject to:
 *   - position limit |h_t| ≤ L
 *   - transaction cost κ per unit traded
 *   - optional terminal flat constraint (h_T = 0)
 *
 * This is NOT a strategy — no live trader has this information. It is a
 * diagnostic ceiling. Comparing a real strategy's Sharpe ratio against the
 * oracle's Sharpe ratio reveals how much of the theoretically-extractable
 * alpha the strategy is actually capturing.
 *
 * Two modes:
 *   - "gross": h_t = sign(r_t), no cost gating. Fast, O(T).
 *   - "net":   dynamic programming over 3 position states ({-L, 0, +L}),
 *              accounts for round-trip cost; trades only when |Δ profit|
 *              > round-trip κ. O(T × 9).
 *
 * Pairs with `tradingConfusionMatrix.ts` (G5) to decompose the strategy↔oracle
 * gap into structural quadrants (precision, recall, alpha leakage).
 *
 * Source: Giller, "Essays on Trading Strategy" (2023), Essay 6.2-6.3.
 * In Giller's SPY example, a "sign-of-alpha" strategy realised Sharpe 2.2
 * was beaten 6× by the gross-profit oracle (Sharpe 12.2) — the gap is the
 * capability deficit, not statistical noise.
 *
 * Pure compute. No I/O.
 */

export const OPTIMAL_TRADING_ORACLE_FLAG_ENV = "GORDON_OPTIMAL_TRADING_ORACLE";

export function isOptimalTradingOracleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[OPTIMAL_TRADING_ORACLE_FLAG_ENV] === "1" ||
    env[OPTIMAL_TRADING_ORACLE_FLAG_ENV] === "true"
  );
}

export type OracleMode = "gross" | "net";

export interface OptimalTradingOracleInput {
  /** Realised returns per period (each as a fraction, e.g. 0.012 = 1.2%). */
  returns: ReadonlyArray<number>;
  /** Optimisation mode: gross-profit ignores cost, net-profit accounts for it. Default "net". */
  mode?: OracleMode;
  /** Transaction cost per unit position traded (same units as returns). Used only in "net" mode. Default 0. */
  transactionCost?: number;
  /** Maximum absolute position. Default 1. */
  positionLimit?: number;
  /** Require terminal position = 0 (must trade out by end). Default false. */
  requireTerminalFlat?: boolean;
  /** Annualisation factor for Sharpe (e.g. 252 for daily returns). Default 1 (no annualisation). */
  periodsPerYear?: number;
}

export interface OptimalTradingOracleResult {
  /** Optimal position sequence (length = returns.length). */
  positions: number[];
  /** Per-period gross profit (h_t × r_t). */
  periodGrossProfits: number[];
  /** Per-period net profit (h_t × r_t − κ × |h_t − h_{t-1}|). */
  periodNetProfits: number[];
  totalGrossProfit: number;
  totalNetProfit: number;
  /** Sharpe ratio of net profits, annualised by √periodsPerYear. */
  sharpeRatio: number;
  /** Number of position changes. */
  transactionCount: number;
  /** Total cost paid (sum of all trade frictions). */
  totalCost: number;
  mode: OracleMode;
  reasoning: string;
}

const POSITION_STATES = [-1, 0, 1] as const;

export function computeOptimalTradingOracle(
  input: OptimalTradingOracleInput,
): OptimalTradingOracleResult {
  const returns = input.returns;
  const mode: OracleMode = input.mode ?? "net";
  const cost = input.transactionCost ?? 0;
  const L = input.positionLimit ?? 1;
  const terminalFlat = input.requireTerminalFlat ?? false;
  const ppy = input.periodsPerYear ?? 1;

  const T = returns.length;
  if (T === 0) {
    return {
      positions: [],
      periodGrossProfits: [],
      periodNetProfits: [],
      totalGrossProfit: 0,
      totalNetProfit: 0,
      sharpeRatio: 0,
      transactionCount: 0,
      totalCost: 0,
      mode,
      reasoning: "empty returns; oracle is trivial",
    };
  }

  const positions = new Array<number>(T).fill(0);

  if (mode === "gross") {
    // sign-of-return oracle: h_t = L × sign(r_t)
    for (let t = 0; t < T; t++) {
      const r = returns[t]!;
      positions[t] = r > 0 ? L : r < 0 ? -L : 0;
    }
  } else {
    // DP: dp[t][s] = best cumulative profit at end of period t holding position s.
    // s ∈ {0, 1, 2} maps to position ∈ {-L, 0, +L}.
    const dp: number[][] = Array.from({ length: T }, () => [
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
    const parent: number[][] = Array.from({ length: T }, () => [0, 0, 0]);

    // t = 0: enter from flat (h_{-1} = 0), pay cost for any non-zero entry.
    for (let s = 0; s < 3; s++) {
      const pos = POSITION_STATES[s]! * L;
      const tradeCost = cost * Math.abs(pos - 0);
      dp[0]![s] = pos * returns[0]! - tradeCost;
      parent[0]![s] = 1; // came from flat state
    }

    for (let t = 1; t < T; t++) {
      for (let s = 0; s < 3; s++) {
        const pos = POSITION_STATES[s]! * L;
        let bestPrev = 0;
        let bestVal = Number.NEGATIVE_INFINITY;
        for (let sp = 0; sp < 3; sp++) {
          const prevPos = POSITION_STATES[sp]! * L;
          const transitionCost = cost * Math.abs(pos - prevPos);
          const v = dp[t - 1]![sp]! - transitionCost + pos * returns[t]!;
          if (v > bestVal) {
            bestVal = v;
            bestPrev = sp;
          }
        }
        dp[t]![s] = bestVal;
        parent[t]![s] = bestPrev;
      }
    }

    let finalS = 0;
    if (terminalFlat) {
      finalS = 1; // flat
    } else {
      let bestFinal = Number.NEGATIVE_INFINITY;
      for (let s = 0; s < 3; s++) {
        if (dp[T - 1]![s]! > bestFinal) {
          bestFinal = dp[T - 1]![s]!;
          finalS = s;
        }
      }
    }

    let s = finalS;
    for (let t = T - 1; t >= 0; t--) {
      positions[t] = POSITION_STATES[s]! * L;
      s = parent[t]![s]!;
    }
  }

  // Compute realised profits, costs, transitions.
  const periodGrossProfits = new Array<number>(T);
  const periodNetProfits = new Array<number>(T);
  let totalGross = 0;
  let totalCost = 0;
  let transactions = 0;
  let prevPos = 0;
  for (let t = 0; t < T; t++) {
    const pos = positions[t]!;
    const gross = pos * returns[t]!;
    const tradeCost = cost * Math.abs(pos - prevPos);
    if (pos !== prevPos) transactions++;
    periodGrossProfits[t] = gross;
    periodNetProfits[t] = gross - tradeCost;
    totalGross += gross;
    totalCost += tradeCost;
    prevPos = pos;
  }
  // Optional exit cost if terminal flat constraint and final position non-zero.
  if (terminalFlat && mode === "net" && prevPos !== 0) {
    const exitCost = cost * Math.abs(prevPos);
    totalCost += exitCost;
    periodNetProfits[T - 1] = periodNetProfits[T - 1]! - exitCost;
  }
  const totalNet = totalGross - totalCost;

  // Sharpe of net per-period profits.
  let mean = 0;
  for (const x of periodNetProfits) mean += x;
  mean /= T;
  let variance = 0;
  for (const x of periodNetProfits) variance += (x - mean) ** 2;
  variance /= Math.max(1, T - 1);
  const stdev = Math.sqrt(variance);
  const sharpe = stdev > 0 ? (mean / stdev) * Math.sqrt(ppy) : 0;

  const reasoning =
    `mode=${mode}; T=${T} periods; gross=${totalGross.toFixed(6)}, ` +
    `net=${totalNet.toFixed(6)}, cost=${totalCost.toFixed(6)}, ` +
    `transactions=${transactions}, sharpe=${sharpe.toFixed(3)}`;

  return {
    positions,
    periodGrossProfits,
    periodNetProfits,
    totalGrossProfit: totalGross,
    totalNetProfit: totalNet,
    sharpeRatio: sharpe,
    transactionCount: transactions,
    totalCost,
    mode,
    reasoning,
  };
}

export function optimalTradingOracleToPayload(
  result: OptimalTradingOracleResult,
): Record<string, unknown> {
  return {
    kind: "optimal_trading_oracle.computed",
    mode: result.mode,
    totalGrossProfit: Number(result.totalGrossProfit.toFixed(8)),
    totalNetProfit: Number(result.totalNetProfit.toFixed(8)),
    sharpeRatio: Number(result.sharpeRatio.toFixed(4)),
    transactionCount: result.transactionCount,
    totalCost: Number(result.totalCost.toFixed(8)),
    horizon: result.positions.length,
  };
}
