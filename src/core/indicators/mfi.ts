/**
 * Money Flow Index (MFI)
 * Volume-weighted RSI — measures buying/selling pressure using price and volume.
 * MFI > 80 = overbought, MFI < 20 = oversold.
 *
 * Based on standard MFI formulation (Quong & Soudack).
 */

import type { Candle } from "./types.ts";

export interface MFIResult {
  /** Current MFI value (0-100) */
  current: number | null;
  /** MFI series */
  values: (number | null)[];
  /** Signal zone */
  signal: "overbought" | "oversold" | "neutral";
  /** Action recommendation */
  action: "potential_buy" | "hold" | "potential_sell";
  /** Money flow direction */
  flowDirection: "positive" | "negative" | "neutral";
  /** Positive money flow sum (for current period) */
  positiveFlow: number;
  /** Negative money flow sum (for current period) */
  negativeFlow: number;
  /** Interpretation string */
  interpretation: string;
}

/**
 * Calculate Money Flow Index.
 *
 * @param candles - OHLCV candle array
 * @param period - MFI lookback period (default 14)
 * @param overboughtLevel - Overbought threshold (default 80)
 * @param oversoldLevel - Oversold threshold (default 20)
 * @returns MFIResult
 */
export function calculateMFI(
  candles: Candle[],
  period: number = 14,
  overboughtLevel: number = 80,
  oversoldLevel: number = 20,
): MFIResult {
  if (candles.length < period + 1) {
    return {
      current: null,
      values: [],
      signal: "neutral",
      action: "hold",
      flowDirection: "neutral",
      positiveFlow: 0,
      negativeFlow: 0,
      interpretation: "Insufficient data for MFI calculation",
    };
  }

  // Step 1: Calculate Typical Price for each candle
  const typicalPrices: number[] = candles.map((c) => (c.high + c.low + c.close) / 3);

  // Step 2: Calculate Raw Money Flow = Typical Price × Volume
  const rawMoneyFlow: number[] = candles.map((c, i) => typicalPrices[i]! * c.volume);

  // Step 3: Classify as positive or negative flow based on typical price direction
  const positiveFlows: number[] = [0]; // First bar has no comparison
  const negativeFlows: number[] = [0];

  for (let i = 1; i < candles.length; i++) {
    if (typicalPrices[i]! > typicalPrices[i - 1]!) {
      positiveFlows.push(rawMoneyFlow[i]!);
      negativeFlows.push(0);
    } else if (typicalPrices[i]! < typicalPrices[i - 1]!) {
      positiveFlows.push(0);
      negativeFlows.push(rawMoneyFlow[i]!);
    } else {
      // Equal typical price — no flow
      positiveFlows.push(0);
      negativeFlows.push(0);
    }
  }

  // Step 4: Rolling sum over period, then calculate MFI
  const mfiValues: (number | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < period) {
      mfiValues.push(null);
      continue;
    }

    let posMF = 0;
    let negMF = 0;
    for (let j = i - period + 1; j <= i; j++) {
      posMF += positiveFlows[j]!;
      negMF += negativeFlows[j]!;
    }

    if (negMF < 1e-10) {
      mfiValues.push(100);
    } else {
      const moneyFlowRatio = posMF / negMF;
      const mfi = 100 - 100 / (1 + moneyFlowRatio);
      mfiValues.push(parseFloat(mfi.toFixed(2)));
    }
  }

  // Current values
  const current = mfiValues[mfiValues.length - 1] ?? null;

  // Calculate current period positive/negative flow for output
  let currentPosFlow = 0;
  let currentNegFlow = 0;
  for (let j = candles.length - period; j < candles.length; j++) {
    currentPosFlow += positiveFlows[j]!;
    currentNegFlow += negativeFlows[j]!;
  }

  // Signal
  let signal: "overbought" | "oversold" | "neutral" = "neutral";
  if (current !== null) {
    if (current >= overboughtLevel) signal = "overbought";
    else if (current <= oversoldLevel) signal = "oversold";
  }

  // Action
  let action: "potential_buy" | "hold" | "potential_sell" = "hold";
  if (signal === "oversold") action = "potential_buy";
  else if (signal === "overbought") action = "potential_sell";

  // Flow direction
  let flowDirection: "positive" | "negative" | "neutral" = "neutral";
  if (current !== null) {
    if (current > 55) flowDirection = "positive";
    else if (current < 45) flowDirection = "negative";
  }

  const interpretation = buildMFIInterpretation(
    current,
    signal,
    flowDirection,
    currentPosFlow,
    currentNegFlow,
  );

  return {
    current,
    values: mfiValues,
    signal,
    action,
    flowDirection,
    positiveFlow: parseFloat(currentPosFlow.toFixed(2)),
    negativeFlow: parseFloat(currentNegFlow.toFixed(2)),
    interpretation,
  };
}

function buildMFIInterpretation(
  mfi: number | null,
  signal: string,
  flowDir: string,
  posFlow: number,
  negFlow: number,
): string {
  if (mfi === null) return "Insufficient data for MFI.";

  let msg = `MFI: ${mfi.toFixed(1)} — `;

  if (signal === "overbought") {
    msg +=
      "OVERBOUGHT zone. Heavy buying pressure may be exhausting — potential reversal/pullback. ";
  } else if (signal === "oversold") {
    msg += "OVERSOLD zone. Heavy selling pressure may be exhausting — potential bounce. ";
  } else {
    msg += `${flowDir === "positive" ? "positive" : flowDir === "negative" ? "negative" : "neutral"} money flow. `;
  }

  const totalFlow = posFlow + negFlow;
  if (totalFlow > 0) {
    const buyPct = (posFlow / totalFlow) * 100;
    msg += `Flow split: ${buyPct.toFixed(0)}% buy / ${(100 - buyPct).toFixed(0)}% sell.`;
  }

  return msg;
}
