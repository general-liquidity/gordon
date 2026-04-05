// Counterfactual Analysis
//
// For every trade proposal, show the user what happens if they approve AND
// what they miss/gain if they deny. Informed consent requires knowing both.

export interface CounterfactualInput {
  symbol: string;
  side: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  sizeUsd: number;
  expectedWinRate: number; // 0-1, from historical performance on similar setups
}

export interface CounterfactualOutcome {
  // If user APPROVES
  approve: {
    expectedValue: number; // probabilistic EV based on win rate
    worstCase: number; // stop hit
    bestCase: number; // target hit
    exposureUsd: number;
  };
  // If user DENIES
  deny: {
    capitalPreserved: number;
    opportunityCost: number; // what they miss if setup works
    downsideAvoided: number; // what they avoid if setup fails
  };
  recommendation: "approve" | "deny" | "neutral";
  reasoning: string;
}

export function computeCounterfactual(input: CounterfactualInput): CounterfactualOutcome {
  const direction = input.side === "LONG" ? 1 : -1;
  const stopPnl = ((input.stopLoss - input.entry) / input.entry) * input.sizeUsd * direction;
  const targetPnl = ((input.takeProfit - input.entry) / input.entry) * input.sizeUsd * direction;

  const loseProb = 1 - input.expectedWinRate;
  const expectedValue = (input.expectedWinRate * targetPnl) + (loseProb * stopPnl);

  const rr = Math.abs(stopPnl) > 0 ? Math.abs(targetPnl / stopPnl) : 0;

  let recommendation: "approve" | "deny" | "neutral" = "neutral";
  let reasoning = "";

  if (expectedValue > 0 && rr >= 1.5) {
    recommendation = "approve";
    reasoning = `Positive EV ($${expectedValue.toFixed(0)}) with ${rr.toFixed(1)}:1 R:R ratio`;
  } else if (expectedValue < 0) {
    recommendation = "deny";
    reasoning = `Negative EV ($${expectedValue.toFixed(0)}). Expected to lose money over many trades.`;
  } else if (rr < 1.5) {
    recommendation = "deny";
    reasoning = `R:R ratio ${rr.toFixed(1)}:1 is below 1.5 threshold for positive expectancy`;
  } else {
    reasoning = `Marginal setup. EV $${expectedValue.toFixed(0)}, R:R ${rr.toFixed(1)}:1`;
  }

  return {
    approve: {
      expectedValue,
      worstCase: stopPnl,
      bestCase: targetPnl,
      exposureUsd: input.sizeUsd,
    },
    deny: {
      capitalPreserved: input.sizeUsd,
      opportunityCost: targetPnl,
      downsideAvoided: Math.abs(stopPnl),
    },
    recommendation,
    reasoning,
  };
}

export function formatCounterfactual(outcome: CounterfactualOutcome): string {
  const lines = [
    "IF APPROVED:",
    `  Expected value:   $${outcome.approve.expectedValue >= 0 ? "+" : ""}${outcome.approve.expectedValue.toFixed(0)}`,
    `  Best case:        $${outcome.approve.bestCase.toFixed(0)}`,
    `  Worst case:       $${outcome.approve.worstCase.toFixed(0)}`,
    `  Capital exposed:  $${outcome.approve.exposureUsd.toFixed(0)}`,
    "",
    "IF DENIED:",
    `  Capital saved:     $${outcome.deny.capitalPreserved.toFixed(0)}`,
    `  Opportunity cost:  -$${outcome.deny.opportunityCost.toFixed(0)} (if setup works)`,
    `  Downside avoided:  +$${outcome.deny.downsideAvoided.toFixed(0)} (if setup fails)`,
    "",
    `Recommendation: ${outcome.recommendation.toUpperCase()}`,
    `  ${outcome.reasoning}`,
  ];
  return lines.join("\n");
}
