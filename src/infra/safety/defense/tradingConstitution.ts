/**
 * Trading Constitution — Immutable Rules That Cannot Be Overridden
 *
 * These are hardcoded limits derived from decades of professional trading
 * wisdom: Van Tharp, Market Wizards, Turtle Traders, institutional hedge
 * fund practice, FINRA/SEC guidelines, prop firm standards, and Kelly
 * Criterion research.
 *
 * The LLM CANNOT override these regardless of user prompt.
 * The user CANNOT disable these via config or settings.
 * These are the final line of defense against catastrophic loss.
 *
 * Sources: See commit message for full bibliography.
 */

// ============================================================================
// The Constitution (IMMUTABLE — do not add config overrides)
// ============================================================================

export const TRADING_CONSTITUTION = {

  // ── Layer 0: Absolute Hard Limits ──

  /** Max single position as % of portfolio. Market Wizards consensus. */
  MAX_POSITION_SIZE_PCT: 5,

  /** Absolute ceiling for position size (even if user tries to override). */
  ABSOLUTE_MAX_POSITION_PCT: 10,

  /** Max daily loss before ALL trading halts. Prop firm standard. */
  MAX_DAILY_LOSS_PCT: 3,

  /** Max total drawdown before ALL trading halts. Requires manual reset. */
  MAX_DRAWDOWN_HALT_PCT: 10,

  /** Emergency liquidation threshold. */
  EMERGENCY_LIQUIDATION_PCT: 15,

  /** Max portfolio heat (total risk across all open positions). Van Tharp. */
  MAX_PORTFOLIO_HEAT_PCT: 15,

  /** Max number of simultaneous open positions. */
  MAX_OPEN_POSITIONS: 20,

  /** Max combined weight for positions with |correlation| > 0.6. */
  MAX_CORRELATED_EXPOSURE_PCT: 25,

  /** Max single sector/asset-class exposure. */
  MAX_SECTOR_EXPOSURE_PCT: 30,

  /** Max leverage ratio (spot equivalent). ESMA consumer protection. */
  MAX_LEVERAGE: 3,

  /** Max trades per hour. Overtrading prevention. */
  MAX_TRADES_PER_HOUR: 20,

  /** Max trades per day. */
  MAX_TRADES_PER_DAY: 50,

  /** Consecutive losing trades before forced cooldown. */
  CONSECUTIVE_LOSS_HALT: 5,

  /** Max loss in any 15-minute window before halt. Flash crash protection. */
  RAPID_LOSS_HALT_PCT: 2,

  // ── Layer 1: Position Sizing ──

  /** Default risk per trade as % of portfolio equity. */
  DEFAULT_RISK_PER_TRADE_PCT: 1,

  /** Absolute max risk per trade. */
  MAX_RISK_PER_TRADE_PCT: 2,

  /** Risk per trade when using leverage. */
  LEVERAGED_RISK_PER_TRADE_PCT: 0.5,

  /** Kelly fraction cap (never use full Kelly). */
  MAX_KELLY_FRACTION: 0.5,

  /** Default Kelly fraction (quarter Kelly). */
  DEFAULT_KELLY_FRACTION: 0.25,

  // ── Layer 2: Drawdown Response (graduated) ──

  /** Drawdown % where sizing reduces to 50%. */
  DRAWDOWN_REDUCE_SIZING_PCT: 5,

  /** Drawdown % where no new positions allowed. */
  DRAWDOWN_NO_NEW_POSITIONS_PCT: 7.5,

  /** Drawdown % where ALL trading halts. */
  DRAWDOWN_HALT_PCT: 10,

  /** Weekly max loss. */
  MAX_WEEKLY_LOSS_PCT: 5,

  /** Monthly max loss. */
  MAX_MONTHLY_LOSS_PCT: 8,

  // ── Layer 3: Stop Loss Rules ──

  /** Every position MUST have a stop loss. No exceptions. */
  MANDATORY_STOP_LOSS: true,

  /** Minimum stop distance (prevents noise-triggered stops). */
  MIN_STOP_DISTANCE_PCT: 0.5,

  /** Maximum stop distance for stocks. */
  MAX_STOP_DISTANCE_STOCKS_PCT: 5,

  /** Maximum stop distance for crypto. */
  MAX_STOP_DISTANCE_CRYPTO_PCT: 8,

  /** Stops can only be tightened, never widened. */
  STOPS_CAN_ONLY_TIGHTEN: true,

  // ── Layer 4: Liquidity Requirements ──

  /** Position must not exceed this % of 24h trading volume. */
  MAX_PCT_OF_DAILY_VOLUME: 1,

  /** Minimum average daily trading volume in USD. */
  MIN_ADTV_USD: 500_000,

  /** Max slippage for major pairs (BTC, ETH). */
  MAX_SLIPPAGE_MAJORS_PCT: 0.5,

  /** Max slippage for mid-cap tokens. */
  MAX_SLIPPAGE_MIDCAP_PCT: 2,

  /** Max slippage for small-cap / low-liquidity. */
  MAX_SLIPPAGE_SMALLCAP_PCT: 3,

  // ── Layer 5: Trade Frequency ──

  /** Max round-trips on same asset in 1 hour. */
  MAX_ROUNDTRIPS_PER_HOUR: 3,

  /** Max reversal trades per day (buy then sell < 5min). */
  MAX_REVERSALS_PER_DAY: 2,

  /** Min seconds between trades on same asset. */
  MIN_SECONDS_BETWEEN_SAME_ASSET: 60,

  // ── Layer 6: DeFi Specific ──

  /** Max exposure to a single DeFi protocol. */
  MAX_SINGLE_PROTOCOL_PCT: 10,

  /** Max total DeFi exposure. */
  MAX_TOTAL_DEFI_PCT: 30,

  /** Max exposure to unaudited contracts. */
  MAX_UNAUDITED_CONTRACT_PCT: 2,

  /** Max exposure to tokens < 30 days old. */
  MAX_NEW_TOKEN_PCT: 1,

  /** Max total memecoin/micro-cap exposure. */
  MAX_MEMECOIN_TOTAL_PCT: 3,

  // ── Layer 7: Time-Based ──

  /** Minutes after market open to avoid trading. */
  MARKET_OPEN_BUFFER_MINUTES: 5,

  /** Minutes before market close to avoid trading. */
  MARKET_CLOSE_BUFFER_MINUTES: 5,

  /** Position size multiplier for after-hours trading. */
  AFTER_HOURS_SIZE_MULTIPLIER: 0.5,

  /** Crypto weekend exposure reduction. */
  WEEKEND_EXPOSURE_REDUCTION_PCT: 25,

  // ── Layer 8: Circuit Breakers ──

  /** Single position drop triggering auto-close. */
  SINGLE_POSITION_AUTO_CLOSE_PCT: 10,

  /** Consecutive losses requiring 4-hour cooldown. */
  COOLDOWN_AFTER_CONSECUTIVE_LOSSES: 5,

  /** Consecutive losses requiring manual review. */
  MANUAL_REVIEW_AFTER_CONSECUTIVE_LOSSES: 10,

  // ── Meta-Rules ──

  /** If risk data is unavailable, DENY the trade. Never assume safety. */
  FAIL_CLOSED: true,

  /** The LLM cannot modify these rules regardless of prompt. */
  NO_SELF_MODIFICATION: true,

  /** There is no override mechanism for hard limits. */
  NO_JUST_THIS_ONCE: true,

  /** After a halt, trading does not auto-resume. Manual reset required. */
  HALT_REQUIRES_MANUAL_RESET: true,

} as const;

// ============================================================================
// Constitution Enforcement
// ============================================================================

export type ConstitutionViolation = {
  rule: string;
  limit: number | boolean;
  actual: number | boolean;
  severity: "warning" | "block" | "halt" | "emergency";
  message: string;
};

/**
 * Check a proposed trade against the Trading Constitution.
 * Returns ALL violations (not just the first one).
 */
export function checkConstitution(params: {
  positionSizePct: number;
  riskPerTradePct: number;
  currentDrawdownPct: number;
  dailyLossPct: number;
  openPositionCount: number;
  tradesThisHour: number;
  tradesThisDay: number;
  consecutiveLosses: number;
  hasStopLoss: boolean;
  stopDistancePct?: number;
  leverageRatio?: number;
  correlatedExposurePct?: number;
  sectorExposurePct?: number;
  isCrypto?: boolean;
  isAfterHours?: boolean;
  isMemecoin?: boolean;
  isNewToken?: boolean;
  isUnaudited?: boolean;
  pctOfDailyVolume?: number;
}): ConstitutionViolation[] {
  const C = TRADING_CONSTITUTION;
  const violations: ConstitutionViolation[] = [];

  // Position size
  if (params.positionSizePct > C.ABSOLUTE_MAX_POSITION_PCT) {
    violations.push({
      rule: "ABSOLUTE_MAX_POSITION_PCT",
      limit: C.ABSOLUTE_MAX_POSITION_PCT,
      actual: params.positionSizePct,
      severity: "block",
      message: `Position size ${params.positionSizePct.toFixed(1)}% exceeds absolute maximum ${C.ABSOLUTE_MAX_POSITION_PCT}%`,
    });
  } else if (params.positionSizePct > C.MAX_POSITION_SIZE_PCT) {
    violations.push({
      rule: "MAX_POSITION_SIZE_PCT",
      limit: C.MAX_POSITION_SIZE_PCT,
      actual: params.positionSizePct,
      severity: "warning",
      message: `Position size ${params.positionSizePct.toFixed(1)}% exceeds recommended maximum ${C.MAX_POSITION_SIZE_PCT}%`,
    });
  }

  // Risk per trade
  if (params.riskPerTradePct > C.MAX_RISK_PER_TRADE_PCT) {
    violations.push({
      rule: "MAX_RISK_PER_TRADE_PCT",
      limit: C.MAX_RISK_PER_TRADE_PCT,
      actual: params.riskPerTradePct,
      severity: "block",
      message: `Risk per trade ${params.riskPerTradePct.toFixed(1)}% exceeds maximum ${C.MAX_RISK_PER_TRADE_PCT}%`,
    });
  }

  // Drawdown
  if (params.currentDrawdownPct >= C.EMERGENCY_LIQUIDATION_PCT) {
    violations.push({
      rule: "EMERGENCY_LIQUIDATION_PCT",
      limit: C.EMERGENCY_LIQUIDATION_PCT,
      actual: params.currentDrawdownPct,
      severity: "emergency",
      message: `EMERGENCY: Drawdown ${params.currentDrawdownPct.toFixed(1)}% exceeds ${C.EMERGENCY_LIQUIDATION_PCT}%. Liquidate all positions.`,
    });
  } else if (params.currentDrawdownPct >= C.DRAWDOWN_HALT_PCT) {
    violations.push({
      rule: "DRAWDOWN_HALT_PCT",
      limit: C.DRAWDOWN_HALT_PCT,
      actual: params.currentDrawdownPct,
      severity: "halt",
      message: `Drawdown ${params.currentDrawdownPct.toFixed(1)}% exceeds halt threshold ${C.DRAWDOWN_HALT_PCT}%. All trading suspended.`,
    });
  } else if (params.currentDrawdownPct >= C.DRAWDOWN_NO_NEW_POSITIONS_PCT) {
    violations.push({
      rule: "DRAWDOWN_NO_NEW_POSITIONS_PCT",
      limit: C.DRAWDOWN_NO_NEW_POSITIONS_PCT,
      actual: params.currentDrawdownPct,
      severity: "block",
      message: `Drawdown ${params.currentDrawdownPct.toFixed(1)}% — no new positions allowed until recovery.`,
    });
  }

  // Daily loss
  if (params.dailyLossPct >= C.MAX_DAILY_LOSS_PCT) {
    violations.push({
      rule: "MAX_DAILY_LOSS_PCT",
      limit: C.MAX_DAILY_LOSS_PCT,
      actual: params.dailyLossPct,
      severity: "halt",
      message: `Daily loss ${params.dailyLossPct.toFixed(1)}% hit maximum ${C.MAX_DAILY_LOSS_PCT}%. Trading halted for today.`,
    });
  }

  // Open positions
  if (params.openPositionCount >= C.MAX_OPEN_POSITIONS) {
    violations.push({
      rule: "MAX_OPEN_POSITIONS",
      limit: C.MAX_OPEN_POSITIONS,
      actual: params.openPositionCount,
      severity: "block",
      message: `${params.openPositionCount} open positions — maximum is ${C.MAX_OPEN_POSITIONS}. Close something first.`,
    });
  }

  // Trade frequency
  if (params.tradesThisHour >= C.MAX_TRADES_PER_HOUR) {
    violations.push({
      rule: "MAX_TRADES_PER_HOUR",
      limit: C.MAX_TRADES_PER_HOUR,
      actual: params.tradesThisHour,
      severity: "block",
      message: `${params.tradesThisHour} trades this hour — maximum is ${C.MAX_TRADES_PER_HOUR}. Cooldown required.`,
    });
  }
  if (params.tradesThisDay >= C.MAX_TRADES_PER_DAY) {
    violations.push({
      rule: "MAX_TRADES_PER_DAY",
      limit: C.MAX_TRADES_PER_DAY,
      actual: params.tradesThisDay,
      severity: "halt",
      message: `${params.tradesThisDay} trades today — maximum is ${C.MAX_TRADES_PER_DAY}. Trading halted for today.`,
    });
  }

  // Consecutive losses
  if (params.consecutiveLosses >= C.MANUAL_REVIEW_AFTER_CONSECUTIVE_LOSSES) {
    violations.push({
      rule: "MANUAL_REVIEW_AFTER_CONSECUTIVE_LOSSES",
      limit: C.MANUAL_REVIEW_AFTER_CONSECUTIVE_LOSSES,
      actual: params.consecutiveLosses,
      severity: "halt",
      message: `${params.consecutiveLosses} consecutive losses. Manual review required before trading resumes.`,
    });
  } else if (params.consecutiveLosses >= C.COOLDOWN_AFTER_CONSECUTIVE_LOSSES) {
    violations.push({
      rule: "COOLDOWN_AFTER_CONSECUTIVE_LOSSES",
      limit: C.COOLDOWN_AFTER_CONSECUTIVE_LOSSES,
      actual: params.consecutiveLosses,
      severity: "block",
      message: `${params.consecutiveLosses} consecutive losses. 4-hour cooldown, sizing reduced 50%.`,
    });
  }

  // Mandatory stop loss
  if (!params.hasStopLoss && C.MANDATORY_STOP_LOSS) {
    violations.push({
      rule: "MANDATORY_STOP_LOSS",
      limit: true,
      actual: false,
      severity: "block",
      message: "Every position MUST have a stop-loss. No exceptions.",
    });
  }

  // Stop distance
  if (params.stopDistancePct !== undefined) {
    const maxStop = params.isCrypto ? C.MAX_STOP_DISTANCE_CRYPTO_PCT : C.MAX_STOP_DISTANCE_STOCKS_PCT;
    if (params.stopDistancePct > maxStop) {
      violations.push({
        rule: "MAX_STOP_DISTANCE",
        limit: maxStop,
        actual: params.stopDistancePct,
        severity: "block",
        message: `Stop distance ${params.stopDistancePct.toFixed(1)}% exceeds maximum ${maxStop}%.`,
      });
    }
    if (params.stopDistancePct < C.MIN_STOP_DISTANCE_PCT) {
      violations.push({
        rule: "MIN_STOP_DISTANCE_PCT",
        limit: C.MIN_STOP_DISTANCE_PCT,
        actual: params.stopDistancePct,
        severity: "warning",
        message: `Stop distance ${params.stopDistancePct.toFixed(2)}% is below minimum ${C.MIN_STOP_DISTANCE_PCT}%. Risk of noise-triggered stop.`,
      });
    }
  }

  // Leverage
  if (params.leverageRatio && params.leverageRatio > C.MAX_LEVERAGE) {
    violations.push({
      rule: "MAX_LEVERAGE",
      limit: C.MAX_LEVERAGE,
      actual: params.leverageRatio,
      severity: "block",
      message: `Leverage ${params.leverageRatio}x exceeds maximum ${C.MAX_LEVERAGE}x.`,
    });
  }

  // Correlated exposure
  if (params.correlatedExposurePct && params.correlatedExposurePct > C.MAX_CORRELATED_EXPOSURE_PCT) {
    violations.push({
      rule: "MAX_CORRELATED_EXPOSURE_PCT",
      limit: C.MAX_CORRELATED_EXPOSURE_PCT,
      actual: params.correlatedExposurePct,
      severity: "block",
      message: `Correlated exposure ${params.correlatedExposurePct.toFixed(1)}% exceeds ${C.MAX_CORRELATED_EXPOSURE_PCT}% limit.`,
    });
  }

  // DeFi specific
  if (params.isMemecoin && params.positionSizePct > C.MAX_MEMECOIN_TOTAL_PCT) {
    violations.push({
      rule: "MAX_MEMECOIN_TOTAL_PCT",
      limit: C.MAX_MEMECOIN_TOTAL_PCT,
      actual: params.positionSizePct,
      severity: "block",
      message: `Memecoin position ${params.positionSizePct.toFixed(1)}% exceeds ${C.MAX_MEMECOIN_TOTAL_PCT}% total memecoin limit.`,
    });
  }
  if (params.isNewToken && params.positionSizePct > C.MAX_NEW_TOKEN_PCT) {
    violations.push({
      rule: "MAX_NEW_TOKEN_PCT",
      limit: C.MAX_NEW_TOKEN_PCT,
      actual: params.positionSizePct,
      severity: "block",
      message: `New token (<30 days) position ${params.positionSizePct.toFixed(1)}% exceeds ${C.MAX_NEW_TOKEN_PCT}% limit.`,
    });
  }
  if (params.isUnaudited && params.positionSizePct > C.MAX_UNAUDITED_CONTRACT_PCT) {
    violations.push({
      rule: "MAX_UNAUDITED_CONTRACT_PCT",
      limit: C.MAX_UNAUDITED_CONTRACT_PCT,
      actual: params.positionSizePct,
      severity: "block",
      message: `Unaudited contract position ${params.positionSizePct.toFixed(1)}% exceeds ${C.MAX_UNAUDITED_CONTRACT_PCT}% limit.`,
    });
  }

  // Liquidity
  if (params.pctOfDailyVolume && params.pctOfDailyVolume > C.MAX_PCT_OF_DAILY_VOLUME) {
    violations.push({
      rule: "MAX_PCT_OF_DAILY_VOLUME",
      limit: C.MAX_PCT_OF_DAILY_VOLUME,
      actual: params.pctOfDailyVolume,
      severity: "block",
      message: `Position is ${params.pctOfDailyVolume.toFixed(2)}% of 24h volume — exceeds ${C.MAX_PCT_OF_DAILY_VOLUME}% limit. Risk of being unable to exit.`,
    });
  }

  return violations;
}

/**
 * Quick check: does this trade pass the constitution?
 */
export function passesConstitution(params: Parameters<typeof checkConstitution>[0]): {
  passes: boolean;
  worstSeverity: ConstitutionViolation["severity"] | "none";
  violations: ConstitutionViolation[];
} {
  const violations = checkConstitution(params);
  if (violations.length === 0) return { passes: true, worstSeverity: "none", violations: [] };

  const severityOrder = { warning: 1, block: 2, halt: 3, emergency: 4 };
  const worstSeverity = violations.reduce((worst, v) =>
    severityOrder[v.severity] > severityOrder[worst] ? v.severity : worst,
    "warning" as ConstitutionViolation["severity"],
  );

  const passes = worstSeverity === "warning"; // Only warnings pass — blocks/halts/emergencies don't

  return { passes, worstSeverity, violations };
}

/**
 * Format constitution violations for display.
 */
export function formatViolations(violations: ConstitutionViolation[]): string {
  if (violations.length === 0) return "All constitution checks passed.";

  const icons = { warning: "\u26A0", block: "\u2717", halt: "\u26D4", emergency: "\uD83D\uDEA8" };
  const lines = violations.map((v) =>
    `${icons[v.severity]} [${v.severity.toUpperCase()}] ${v.message}`
  );

  return `Trading Constitution Violations (${violations.length}):\n${lines.join("\n")}`;
}
