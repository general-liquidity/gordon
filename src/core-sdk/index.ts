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

// Gateway advanced features
export { evaluateBaselineCircuitBreakers } from "../gateway/circuit-breakers/index.ts";
export { simulateOrderBundle } from "../gateway/advanced/counterfactual.ts";
export { generateCircuitBreakerProof, verifyCircuitBreakerProof } from "../gateway/advanced/circuit-breaker-proof.ts";
export { queryRegimeScopedMemory } from "../gateway/advanced/regime-memory.ts";

// SDK client
export { GordonSDKClient, createGordonSDKClient } from "../sdk/index.ts";
export type { SDKConfig, SDKCommandResponse, DaemonStatus } from "../sdk/types.ts";
