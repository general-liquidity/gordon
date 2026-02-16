/**
 * @gordon/core-style extraction surface (local first-cut).
 *
 * This module re-exports trading primitives so external agents can build on
 * Gordon without importing deep internal paths.
 */

export { StrategyRuntime } from "../core/runtime/engine.ts";
export { riskKernel } from "../core/risk-kernel/index.ts";
export { evaluateBaselineCircuitBreakers } from "../gateway/circuit-breakers/index.ts";
export { simulateOrderBundle } from "../gateway/advanced/counterfactual.ts";
export { generateCircuitBreakerProof, verifyCircuitBreakerProof } from "../gateway/advanced/circuit-breaker-proof.ts";
export { queryRegimeScopedMemory } from "../gateway/advanced/regime-memory.ts";
export type { Exchange } from "../infra/exchange/index.ts";

