/**
 * @gordon/core-style extraction surface (local first-cut).
 *
 * This module re-exports trading primitives so external agents can build on
 * Gordon without importing deep internal paths.
 */

// Trading primitives
export { StrategyRuntime } from "../core/runtime/engine.ts";
export { riskKernel } from "../core/risk-kernel/index.ts";
export type { Exchange } from "../infra/exchange/index.ts";
export type { BrokerAdapter } from "../infra/broker/index.ts";

// Gateway advanced features
export { evaluateBaselineCircuitBreakers } from "../gateway/circuit-breakers/index.ts";
export { simulateOrderBundle } from "../gateway/advanced/counterfactual.ts";
export {
  generateCircuitBreakerProof,
  verifyCircuitBreakerProof,
} from "../gateway/advanced/circuit-breaker-proof.ts";
export { queryRegimeScopedMemory } from "../gateway/advanced/regime-memory.ts";

// SDK client and factory
export {
  GordonSDKClient,
  createGordonSDK,
  createGordonSDKClient,
} from "../sdk/index.ts";

// SDK types
export type {
  SDKConfig,
  SDKConfigInput,
  SDKConnectionState,
  SDKCommandResponse,
  SDKEvent,
  SDKEventType,
  SDKEventHandler,
  EventSubscription,
  ScanOptions,
  MonitorOptions,
  SetPermissionModeOptions,
  ScheduleTaskOptions,
  HealthCheckOptions,
  ReconcileOptions,
  PluginReloadOptions,
  SendMessageOptions,
  DaemonStatus,
  ScheduledTaskInfo,
} from "../sdk/types.ts";

// SDK errors
export {
  GordonSDKError,
  ConnectionError,
  AuthenticationError,
  QueueBackpressureError,
  RiskBlockedError,
  TimeoutError,
  ValidationError,
  IdempotencyConflictError,
  CircuitBreakerOpenError,
  HandoffBudgetExceededError,
  createSDKErrorFromGateway,
  isGordonSDKError,
  isRetryableError,
} from "../sdk/errors.ts";
