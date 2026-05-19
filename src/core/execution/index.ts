/**
 * Intent-Based Execution Engine
 *
 * Algorithmic execution (TWAP, VWAP, Iceberg) with natural language
 * intent parsing. Manages execution sessions with pause/resume/cancel.
 */

// Types
export type {
  ExecutionAlgorithm,
  ExecutionIntent,
  ExecutionSession,
  ExecutionSessionStatus,
  ExecutionSlice,
  TWAPConfig,
  VWAPConfig,
  IcebergConfig,
  POVConfig,
} from "./algorithms/types.ts";

export {
  ExecutionAlgorithmSchema,
  DEFAULT_TWAP_CONFIG,
  DEFAULT_VWAP_CONFIG,
  DEFAULT_ICEBERG_CONFIG,
  DEFAULT_POV_CONFIG,
} from "./algorithms/types.ts";

// Algorithms
export { TWAPExecutor } from "./algorithms/twap.ts";
export { VWAPExecutor } from "./algorithms/vwap.ts";
export { IcebergExecutor } from "./algorithms/iceberg.ts";
export { POVExecutor } from "./algorithms/pov.ts";

// Session management
export { ExecutionSessionManager } from "./session-manager.ts";

// Intent parsing
export { parseExecutionIntent, describeIntent } from "./intent-parser.ts";
