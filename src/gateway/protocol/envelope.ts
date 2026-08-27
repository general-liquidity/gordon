import { randomUUID } from "node:crypto";
import { z } from "zod";

/**
 * Shared envelope metadata for all gateway traffic.
 *
 * - `correlationId` tracks a workflow across hops.
 * - `idempotencyKey` deduplicates mutating commands.
 */
export const EnvelopeMetaSchema = z.object({
  requestId: z.string().min(8).max(128),
  correlationId: z.string().min(8).max(128),
  idempotencyKey: z.string().min(8).max(256).optional(),
  sessionId: z.string().min(1).max(128),
  source: z.enum(["cli", "daemon", "scheduler", "reconciler", "agent", "system"]).default("cli"),
  timestamp: z.string().datetime(),
});

export type EnvelopeMeta = z.infer<typeof EnvelopeMetaSchema>;

export function createCorrelationId(prefix = "corr"): string {
  return `${prefix}_${randomUUID()}`;
}

export function createRequestId(prefix = "req"): string {
  return `${prefix}_${randomUUID()}`;
}

export function createEnvelopeMeta(input: {
  sessionId: string;
  source?: EnvelopeMeta["source"];
  correlationId?: string;
  idempotencyKey?: string;
}): EnvelopeMeta {
  const now = new Date().toISOString();
  return {
    requestId: createRequestId(),
    correlationId: input.correlationId ?? createCorrelationId(),
    idempotencyKey: input.idempotencyKey,
    sessionId: input.sessionId,
    source: input.source ?? "cli",
    timestamp: now,
  };
}
