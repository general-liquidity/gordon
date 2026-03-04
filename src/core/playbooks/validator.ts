/**
 * Playbook Protocol Validator
 *
 * Validates a PlaybookProtocol object against the formal schema,
 * checks logical consistency between fields, and warns on risky
 * configurations. Returns a structured result with errors and warnings.
 */

import { PlaybookProtocolSchema } from "./protocol.ts";
import type { PlaybookProtocol } from "./protocol.ts";

// ============================================================================
// Validation Result
// ============================================================================

export interface ProtocolValidationResult {
  /** Whether the playbook passes all required checks */
  valid: boolean;
  /** Blocking errors — playbook cannot be used */
  errors: string[];
  /** Non-blocking warnings — playbook can be used but may have issues */
  warnings: string[];
}

// ============================================================================
// Schema Validation
// ============================================================================

/**
 * Validate a raw unknown value against the PlaybookProtocol schema.
 * Runs Zod parsing first, then logical consistency checks, then risk warnings.
 *
 * @param playbook - Unknown value to validate
 * @returns Structured validation result
 */
export function validatePlaybook(playbook: unknown): ProtocolValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ---- Step 1: Zod schema validation ----
  const parsed = PlaybookProtocolSchema.safeParse(playbook);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      errors.push(`${path}: ${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }

  const pb = parsed.data;

  // ---- Step 2: Logical consistency checks ----

  // Confluence required should not exceed number of indicators
  if (pb.entry.confluence_required > pb.entry.indicators.length) {
    errors.push(
      `entry.confluence_required (${pb.entry.confluence_required}) exceeds the number of indicators (${pb.entry.indicators.length})`
    );
  }

  // Take profit levels should sum to <= 100%
  const tpTotalPercent = pb.exit.take_profit.reduce((sum, tp) => sum + tp.size_percent, 0);
  if (tpTotalPercent > 100) {
    errors.push(
      `exit.take_profit levels sum to ${tpTotalPercent}% — cannot exceed 100%`
    );
  }

  // Stop loss value should make sense (not zero or negative)
  if (pb.exit.stop_loss.value <= 0) {
    errors.push(
      `exit.stop_loss.value must be positive (got ${pb.exit.stop_loss.value})`
    );
  }

  // Take profit levels should all be positive
  for (let i = 0; i < pb.exit.take_profit.length; i++) {
    const tp = pb.exit.take_profit[i]!;
    if (tp.level <= 0) {
      errors.push(
        `exit.take_profit[${i}].level must be positive (got ${tp.level})`
      );
    }
    if (tp.size_percent <= 0 || tp.size_percent > 100) {
      errors.push(
        `exit.take_profit[${i}].size_percent must be between 0 and 100 (got ${tp.size_percent})`
      );
    }
  }

  // Trailing stop: if enabled, activation and distance should be set
  if (pb.exit.trailing_stop?.enabled) {
    if (pb.exit.trailing_stop.activation === undefined && pb.exit.trailing_stop.distance === undefined) {
      warnings.push(
        "exit.trailing_stop is enabled but neither activation nor distance is set"
      );
    }
  }

  // Risk: max risk per trade should be less than max position size
  if (pb.risk.max_risk_per_trade_percent > pb.risk.max_position_size_percent) {
    warnings.push(
      `risk.max_risk_per_trade_percent (${pb.risk.max_risk_per_trade_percent}%) exceeds max_position_size_percent (${pb.risk.max_position_size_percent}%) — unusual configuration`
    );
  }

  // ---- Step 3: Risk warnings ----

  // High risk per trade
  if (pb.risk.max_risk_per_trade_percent > 5) {
    warnings.push(
      `risk.max_risk_per_trade_percent is ${pb.risk.max_risk_per_trade_percent}% — values above 5% are considered very aggressive`
    );
  }

  // Large position sizes
  if (pb.risk.max_position_size_percent > 25) {
    warnings.push(
      `risk.max_position_size_percent is ${pb.risk.max_position_size_percent}% — concentrating more than 25% in a single position is risky`
    );
  }

  // Many concurrent positions
  if (pb.risk.max_concurrent_positions > 20) {
    warnings.push(
      `risk.max_concurrent_positions is ${pb.risk.max_concurrent_positions} — managing more than 20 simultaneous positions is difficult`
    );
  }

  // No take profit levels defined
  if (pb.exit.take_profit.length === 0) {
    warnings.push(
      "exit.take_profit has no levels defined — consider adding at least one target"
    );
  }

  // No entry filters
  if (!pb.entry.filters || pb.entry.filters.length === 0) {
    warnings.push(
      "entry.filters is empty — consider adding filters to reduce false signals"
    );
  }

  // Aggressive tier with high risk
  if (pb.tier === "3-aggressive" && pb.risk.max_risk_per_trade_percent > 3) {
    warnings.push(
      "Aggressive tier with >3% risk per trade — ensure this matches your risk tolerance"
    );
  }

  // No daily loss limit
  if (pb.risk.max_daily_loss_percent === undefined) {
    warnings.push(
      "risk.max_daily_loss_percent is not set — consider adding a daily loss circuit breaker"
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
