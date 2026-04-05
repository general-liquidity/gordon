// Debate Mode
//
// Optional adversarial reasoning for high-stakes, longer-timeframe decisions.
// NOT for fast trades. Only activates on explicit opt-in or when context
// warrants deep analysis (large positions, multi-week holds, macro decisions).
//
// Stages:
//   1. Investment Debate: Bull vs Bear (multiple rounds)
//   2. Manager synthesizes investment plan
//   3. Risk Debate: Aggressive vs Conservative vs Neutral
//   4. Portfolio Manager makes final call
//
// Output: Full visible reasoning chain so user can audit the decision.

export type DebateRole =
  | "bull"
  | "bear"
  | "manager"
  | "aggressive"
  | "conservative"
  | "neutral"
  | "portfolio_manager";

export interface DebateRound {
  roundNumber: number;
  role: DebateRole;
  argument: string;
  keyPoints: string[];
  confidence: number;
  respondsTo?: string; // ID of previous turn this counters
  timestamp: number;
}

export interface InvestmentDebate {
  symbol: string;
  context: string;
  rounds: DebateRound[];
  managerSynthesis?: {
    conclusion: string;
    supportingArgs: string[];
    counterArgs: string[];
    investmentPlan: string;
  };
}

export interface RiskDebate {
  proposedPlan: string;
  rounds: DebateRound[];
  portfolioManagerDecision?: {
    verdict: "approve" | "modify" | "reject";
    reasoning: string;
    modifications?: string[];
  };
}

export interface DebateResult {
  symbol: string;
  timestamp: number;
  investmentDebate: InvestmentDebate;
  riskDebate: RiskDebate;
  finalDecision: {
    action: "BUY" | "SELL" | "HOLD" | "NO_ACTION";
    confidence: number;
    reasoning: string;
    keyFactors: string[];
  };
  durationMs: number;
  totalRounds: number;
}

export interface DebateConfig {
  maxInvestmentRounds?: number; // default 2 (= 4 total: bull, bear, bull, bear)
  maxRiskRounds?: number; // default 1 (= 3 total: agg, cons, neut)
  timeframeMinimum?: "1h" | "4h" | "1d" | "1w" | "1M"; // default "1d"
  positionSizeThresholdPct?: number; // default 0.05 (5%)
  holdDurationMinDays?: number; // default 7
}

export interface DebateTrigger {
  explicitRequest: boolean;
  effortMode?: "low" | "medium" | "high" | "max";
  positionSizePct?: number;
  holdDurationDays?: number;
  timeframe?: string;
}

export function shouldActivateDebate(
  trigger: DebateTrigger,
  config?: DebateConfig,
): {
  activate: boolean;
  reason: string;
} {
  const cfg = {
    timeframeMinimum: "1d" as const,
    positionSizeThresholdPct: 0.05,
    holdDurationMinDays: 7,
    ...config,
  };

  // Explicit request always activates
  if (trigger.explicitRequest) {
    return { activate: true, reason: "User explicitly requested debate" };
  }

  // Max effort mode activates
  if (trigger.effortMode === "max") {
    return { activate: true, reason: "Effort mode = max" };
  }

  // Timeframe check (debate only for longer timeframes)
  const timeframes = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"];
  if (trigger.timeframe) {
    const tfIdx = timeframes.indexOf(trigger.timeframe);
    const minIdx = timeframes.indexOf(cfg.timeframeMinimum);
    if (tfIdx < minIdx) {
      return {
        activate: false,
        reason: `Timeframe ${trigger.timeframe} too short for debate (min: ${cfg.timeframeMinimum})`,
      };
    }
  }

  // Large position activates
  if (
    trigger.positionSizePct &&
    trigger.positionSizePct >= cfg.positionSizeThresholdPct
  ) {
    return {
      activate: true,
      reason: `Position size ${(trigger.positionSizePct * 100).toFixed(1)}% exceeds threshold`,
    };
  }

  // Long hold duration activates
  if (
    trigger.holdDurationDays &&
    trigger.holdDurationDays >= cfg.holdDurationMinDays
  ) {
    return {
      activate: true,
      reason: `Hold duration ${trigger.holdDurationDays}d exceeds threshold`,
    };
  }

  return {
    activate: false,
    reason: "Standard consensus sufficient for this decision",
  };
}

export const BULL_PROMPT = `You are a Bull researcher advocating for going LONG on {symbol}.
Context: {context}
{previousArguments}
Present the strongest bullish case in 2-4 key points. Cite specific data,
catalysts, and upside scenarios. Your confidence should be 1-10.
Respond in JSON: { "argument": "...", "keyPoints": ["...", "..."], "confidence": N }`;

export const BEAR_PROMPT = `You are a Bear researcher advocating AGAINST going long on {symbol}.
Context: {context}
{previousArguments}
Present the strongest bearish case in 2-4 key points. Cite risks, bearish
catalysts, downside scenarios, and overvaluation concerns.
Respond in JSON: { "argument": "...", "keyPoints": ["...", "..."], "confidence": N }`;

export const MANAGER_PROMPT = `You are the Research Manager. Review the debate between Bull and Bear.
Bull rounds: {bullRounds}
Bear rounds: {bearRounds}
Synthesize a balanced investment plan. Which side had the stronger case?
What are the key supporting and counter arguments? What's the actionable plan?
Respond in JSON: { "conclusion": "...", "supportingArgs": [...], "counterArgs": [...], "investmentPlan": "..." }`;

export const RISK_AGGRESSIVE_PROMPT = `You are the Aggressive Risk analyst. Challenge the investment plan below.
Plan: {plan}
Argue: "Why aren't we taking MORE risk? What's the asymmetric upside we're missing?"
Respond in JSON: { "argument": "...", "keyPoints": [...], "confidence": N }`;

export const RISK_CONSERVATIVE_PROMPT = `You are the Conservative Risk analyst. Challenge the investment plan below.
Plan: {plan}
Argue: "What if volatility spikes? What's the worst realistic drawdown? Why risk this capital?"
Respond in JSON: { "argument": "...", "keyPoints": [...], "confidence": N }`;

export const RISK_NEUTRAL_PROMPT = `You are the Neutral Risk analyst. Synthesize aggressive and conservative views on the plan.
Plan: {plan}
Aggressive view: {aggressiveArg}
Conservative view: {conservativeArg}
What's the break-even scenario? What position size balances both concerns?
Respond in JSON: { "argument": "...", "keyPoints": [...], "confidence": N }`;

export const PM_PROMPT = `You are the Portfolio Manager. Make the final decision.
Investment Plan: {plan}
Risk Debate:
  Aggressive: {aggressive}
  Conservative: {conservative}
  Neutral: {neutral}
Final verdict: approve, modify (with changes), or reject.
Respond in JSON: { "verdict": "approve|modify|reject", "reasoning": "...", "modifications": [...] }`;

// Stub orchestrator - actual LLM calls would be wired through existing agent infrastructure
export async function runDebate(
  symbol: string,
  context: string,
  runAgentPrompt: (role: DebateRole, prompt: string) => Promise<any>,
  config?: DebateConfig,
): Promise<DebateResult> {
  const startTime = Date.now();
  const cfg = { maxInvestmentRounds: 2, maxRiskRounds: 1, ...config };

  const investmentDebate: InvestmentDebate = {
    symbol,
    context,
    rounds: [],
  };

  // Investment Debate: Bull <-> Bear
  let prevArgs = "";
  for (let round = 1; round <= cfg.maxInvestmentRounds; round++) {
    const bullResp = await runAgentPrompt(
      "bull",
      BULL_PROMPT.replace("{symbol}", symbol)
        .replace("{context}", context)
        .replace("{previousArguments}", prevArgs),
    );
    investmentDebate.rounds.push({
      roundNumber: round,
      role: "bull",
      argument: bullResp.argument,
      keyPoints: bullResp.keyPoints,
      confidence: bullResp.confidence,
      timestamp: Date.now(),
    });
    prevArgs += `\nBull round ${round}: ${bullResp.argument}`;

    const bearResp = await runAgentPrompt(
      "bear",
      BEAR_PROMPT.replace("{symbol}", symbol)
        .replace("{context}", context)
        .replace("{previousArguments}", prevArgs),
    );
    investmentDebate.rounds.push({
      roundNumber: round,
      role: "bear",
      argument: bearResp.argument,
      keyPoints: bearResp.keyPoints,
      confidence: bearResp.confidence,
      timestamp: Date.now(),
    });
    prevArgs += `\nBear round ${round}: ${bearResp.argument}`;
  }

  // Manager synthesis
  const bullRounds = investmentDebate.rounds
    .filter((r) => r.role === "bull")
    .map((r) => r.argument)
    .join("\n");
  const bearRounds = investmentDebate.rounds
    .filter((r) => r.role === "bear")
    .map((r) => r.argument)
    .join("\n");
  const managerResp = await runAgentPrompt(
    "manager",
    MANAGER_PROMPT.replace("{bullRounds}", bullRounds).replace(
      "{bearRounds}",
      bearRounds,
    ),
  );
  investmentDebate.managerSynthesis = managerResp;

  // Risk Debate: Aggressive -> Conservative -> Neutral
  const riskDebate: RiskDebate = {
    proposedPlan: managerResp.investmentPlan,
    rounds: [],
  };

  const aggResp = await runAgentPrompt(
    "aggressive",
    RISK_AGGRESSIVE_PROMPT.replace("{plan}", managerResp.investmentPlan),
  );
  riskDebate.rounds.push({
    roundNumber: 1,
    role: "aggressive",
    argument: aggResp.argument,
    keyPoints: aggResp.keyPoints,
    confidence: aggResp.confidence,
    timestamp: Date.now(),
  });

  const consResp = await runAgentPrompt(
    "conservative",
    RISK_CONSERVATIVE_PROMPT.replace("{plan}", managerResp.investmentPlan),
  );
  riskDebate.rounds.push({
    roundNumber: 1,
    role: "conservative",
    argument: consResp.argument,
    keyPoints: consResp.keyPoints,
    confidence: consResp.confidence,
    timestamp: Date.now(),
  });

  const neutralResp = await runAgentPrompt(
    "neutral",
    RISK_NEUTRAL_PROMPT.replace("{plan}", managerResp.investmentPlan)
      .replace("{aggressiveArg}", aggResp.argument)
      .replace("{conservativeArg}", consResp.argument),
  );
  riskDebate.rounds.push({
    roundNumber: 1,
    role: "neutral",
    argument: neutralResp.argument,
    keyPoints: neutralResp.keyPoints,
    confidence: neutralResp.confidence,
    timestamp: Date.now(),
  });

  // Portfolio Manager final decision
  const pmResp = await runAgentPrompt(
    "portfolio_manager",
    PM_PROMPT.replace("{plan}", managerResp.investmentPlan)
      .replace("{aggressive}", aggResp.argument)
      .replace("{conservative}", consResp.argument)
      .replace("{neutral}", neutralResp.argument),
  );
  riskDebate.portfolioManagerDecision = pmResp;

  const action: "BUY" | "SELL" | "HOLD" | "NO_ACTION" =
    pmResp.verdict === "approve"
      ? "BUY"
      : pmResp.verdict === "reject"
        ? "NO_ACTION"
        : "HOLD";

  const avgConf =
    investmentDebate.rounds
      .concat(riskDebate.rounds)
      .reduce((s, r) => s + r.confidence, 0) /
    (investmentDebate.rounds.length + riskDebate.rounds.length);

  return {
    symbol,
    timestamp: Date.now(),
    investmentDebate,
    riskDebate,
    finalDecision: {
      action,
      confidence: Math.round(avgConf),
      reasoning: pmResp.reasoning,
      keyFactors: [
        ...(managerResp.supportingArgs ?? []),
        ...(pmResp.modifications ?? []),
      ].slice(0, 5),
    },
    durationMs: Date.now() - startTime,
    totalRounds:
      investmentDebate.rounds.length + riskDebate.rounds.length + 2, // +manager +PM
  };
}
