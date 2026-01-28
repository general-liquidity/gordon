import { z } from "zod";

export const EventTypeSchema = z.enum([
  "INTENT",
  "SCAN",
  "ANALYZE",
  "PLAN_CREATED",
  "PLAN_APPROVED",
  "ORDER_PLACED",
  "ORDER_FILLED",
  "ALERT",
  "ERROR",
]);

export const EventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  type: EventTypeSchema,
  data: z.record(z.string(), z.any()),
  planId: z.string().optional(),
  tradeId: z.string().optional(),
});

export type EventType = z.infer<typeof EventTypeSchema>;
export type Event = z.infer<typeof EventSchema>;
