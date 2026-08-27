import { createHash } from "node:crypto";
import {
  evaluateBaselineCircuitBreakers,
  type BaselineCircuitBreakerInput,
} from "../circuit-breakers/index.ts";

export interface CircuitBreakerProof {
  generatedAt: string;
  input: BaselineCircuitBreakerInput;
  open: boolean;
  triggers: Array<{ name: string; current: number; threshold: number; message: string }>;
  commitment: string;
}

/**
 * Generate a machine-checkable proof object for baseline circuit breaker state.
 */
export function generateCircuitBreakerProof(
  input: BaselineCircuitBreakerInput,
): CircuitBreakerProof {
  const result = evaluateBaselineCircuitBreakers(input);
  const generatedAt = new Date().toISOString();
  const canonical = JSON.stringify({
    generatedAt,
    input,
    open: result.open,
    triggers: result.triggers,
  });
  const commitment = createHash("sha256").update(canonical).digest("hex");

  return {
    generatedAt,
    input,
    open: result.open,
    triggers: result.triggers,
    commitment,
  };
}

export function verifyCircuitBreakerProof(proof: CircuitBreakerProof): boolean {
  const canonical = JSON.stringify({
    generatedAt: proof.generatedAt,
    input: proof.input,
    open: proof.open,
    triggers: proof.triggers,
  });
  const expected = createHash("sha256").update(canonical).digest("hex");
  return expected === proof.commitment;
}
