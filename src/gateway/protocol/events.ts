import { z } from "zod";
import { EnvelopeMetaSchema } from "./envelope.ts";

export const GatewayEventTypeSchema = z.enum([
  "command.accepted",
  "command.rejected",
  "command.completed",
  "command.failed",
  "queue.backpressure",
  "security.blocked",
  "risk.blocked",
  "risk.modified",
  "handoff.approved",
  "handoff.rejected",
  "scheduler.triggered",
  "reconcile.completed",
  "daemon.started",
  "daemon.stopped",
]);

export type GatewayEventType = z.infer<typeof GatewayEventTypeSchema>;

export const GatewayEventEnvelopeSchema = z.object({
  meta: EnvelopeMetaSchema,
  event: z.object({
    type: GatewayEventTypeSchema,
    payload: z.record(z.string(), z.unknown()).default({}),
  }),
});

export type GatewayEventEnvelope = z.infer<typeof GatewayEventEnvelopeSchema>;
