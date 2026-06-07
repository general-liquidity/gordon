/**
 * Inverse-contract (coin-margined) PnL convexity.
 *
 * An inverse perp (XBTUSD-style: $1 notional, settled in BTC) has a non-linear
 * BTC payoff because PnL ∝ (1/entry − 1/exit). For a LONG, an equal-percentage
 * adverse (down) move costs MORE BTC than a favorable (up) move earns — negative
 * convexity — so longs liquidate faster on the way down. Shorts get the mirror
 * (positive) convexity. Aggregated across an inverse-dominated market this is
 * why "dumps are more extreme than pumps" (BitMEX, "convexity, rektum…").
 *
 * This quantifies the asymmetry for a symmetric ±movePct shock. Pure; never
 * throws. A LINEAR (USDT-margined) contract has asymmetryRatio = 1 by contrast.
 */

export interface InverseConvexityInput {
  entryPrice: number;
  /** Fractional move magnitude to evaluate symmetrically, e.g. 0.2 = ±20%. (0,1). */
  movePct: number;
  side?: "long" | "short";
  /** USD notional (1 XBTUSD contract = $1). Default 1. */
  contractsUsd?: number;
}

export interface InverseConvexityResult {
  side: "long" | "short";
  entryPrice: number;
  movePct: number;
  favorableExit: number;
  adverseExit: number;
  /** BTC PnL on the favorable move (positive). */
  favorablePnlBtc: number;
  /** BTC PnL on the adverse move (negative). */
  adversePnlBtc: number;
  /** |adverse| / |favorable|. >1 = negative convexity (long), <1 = positive (short). */
  asymmetryRatio: number;
  convexity: "negative" | "positive" | "neutral";
  interpretation: string;
}

const round = (x: number, p = 8): number => parseFloat(x.toFixed(p));

export function computeInverseConvexity(input: InverseConvexityInput): InverseConvexityResult {
  const side = input.side ?? "long";
  const entry = input.entryPrice;
  const movePct = input.movePct;
  const notional = input.contractsUsd ?? 1;

  const invalid = (reason: string): InverseConvexityResult => ({
    side,
    entryPrice: entry,
    movePct,
    favorableExit: 0,
    adverseExit: 0,
    favorablePnlBtc: 0,
    adversePnlBtc: 0,
    asymmetryRatio: 1,
    convexity: "neutral",
    interpretation: reason,
  });

  if (!(entry > 0)) return invalid("entryPrice must be > 0");
  if (!(movePct > 0 && movePct < 1)) return invalid("movePct must be in (0, 1)");

  const upExit = entry * (1 + movePct);
  const downExit = entry * (1 - movePct);
  // Long BTC PnL for a $notional position closing at `exit`.
  const longPnl = (exit: number): number => notional * (1 / entry - 1 / exit);

  let favorableExit: number;
  let adverseExit: number;
  let favorablePnlBtc: number;
  let adversePnlBtc: number;
  if (side === "long") {
    favorableExit = upExit;
    adverseExit = downExit;
    favorablePnlBtc = longPnl(upExit); // > 0
    adversePnlBtc = longPnl(downExit); // < 0
  } else {
    favorableExit = downExit;
    adverseExit = upExit;
    favorablePnlBtc = -longPnl(downExit); // short profits on the way down
    adversePnlBtc = -longPnl(upExit); // short loses on the way up
  }

  const asymmetryRatio =
    favorablePnlBtc !== 0 ? Math.abs(adversePnlBtc) / Math.abs(favorablePnlBtc) : 1;
  const convexity: InverseConvexityResult["convexity"] =
    asymmetryRatio > 1.0001 ? "negative" : asymmetryRatio < 0.9999 ? "positive" : "neutral";

  const interpretation =
    `inverse ${side}: a ±${(movePct * 100).toFixed(1)}% shock loses ${round(asymmetryRatio, 3)}× ` +
    `the BTC on the adverse leg vs the favorable leg (${convexity} convexity). ` +
    (side === "long"
      ? "Longs liquidate faster on the way down — in inverse-dominated markets, dumps run deeper than pumps."
      : "Shorts gain more BTC on the way down than they lose on the way up.");

  return {
    side,
    entryPrice: entry,
    movePct,
    favorableExit: round(favorableExit),
    adverseExit: round(adverseExit),
    favorablePnlBtc: round(favorablePnlBtc),
    adversePnlBtc: round(adversePnlBtc),
    asymmetryRatio: round(asymmetryRatio, 4),
    convexity,
    interpretation,
  };
}
