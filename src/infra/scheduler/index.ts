/**
 * Scheduler enhancements — portable utilities that work with any cron/runner.
 *
 *  - ActiveHours:   timezone-aware market-hours gating
 *  - cronPolicies:  FulfillmentMode (keep/once/ask) + consecutive-error disable
 *  - HEARTBEAT.md:  declarative monitoring checklist
 */

export {
  isWithinActiveHours,
  nextActiveHoursStart,
  waitUntilActive,
  US_EQUITY_MARKET_HOURS,
  US_EQUITY_EXTENDED_HOURS,
  CRYPTO_ALWAYS_ACTIVE,
  CME_FUTURES_HOURS,
} from "./activeHours.ts";
export type { ActiveHours } from "./activeHours.ts";

export {
  decideJobRun,
  updateStateAfterRun,
  shouldAutoDisable,
  initialJobRunState,
  DEFAULT_ERROR_DISABLE_THRESHOLD,
} from "./cronPolicies.ts";
export type {
  FulfillmentMode,
  JobRunState,
  PolicyDecision,
  RunOutcome,
  DecideRunInput,
} from "./cronPolicies.ts";

export {
  readHeartbeat,
  writeHeartbeat,
  addHeartbeatItem,
  removeHeartbeatItem,
  parseHeartbeat,
  initializeHeartbeatIfMissing,
  buildHeartbeatQuery,
  DEFAULT_HEARTBEAT_TEMPLATE,
  HEARTBEAT_MD_PATH,
} from "./heartbeatChecklist.ts";
export type { HeartbeatChecklist } from "./heartbeatChecklist.ts";
