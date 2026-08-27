import { z } from "zod";

export const GatewayErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "AUTH_REQUIRED",
  "AUTH_INVALID",
  "REPLAY_DETECTED",
  "IDEMPOTENCY_CONFLICT",
  "QUEUE_BACKPRESSURE",
  "RISK_BLOCKED",
  "CIRCUIT_BREAKER_OPEN",
  "HANDOFF_BUDGET_EXCEEDED",
  "COMMAND_NOT_SUPPORTED",
  "INTERNAL_ERROR",
]);

export type GatewayErrorCode = z.infer<typeof GatewayErrorCodeSchema>;

export interface GatewayError {
  code: GatewayErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

export function createGatewayError(
  code: GatewayErrorCode,
  message: string,
  details?: Record<string, unknown>,
  retryable: boolean = false,
): GatewayError {
  return { code, message, details, retryable };
}
