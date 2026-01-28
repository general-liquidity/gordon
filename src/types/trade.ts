import { z } from "zod";

export const EntryFillSchema = z.object({
  orderId: z.string(),
  price: z.number(),
  quantity: z.number(),
  filledAt: z.string(),
});

export const ExitFillSchema = z.object({
  orderId: z.string(),
  price: z.number(),
  quantity: z.number(),
  filledAt: z.string(),
  reason: z.enum(["TP1", "TP2", "TP3", "STOP", "MANUAL"]),
});

export const TradeSchema = z.object({
  id: z.string(),
  planId: z.string(),

  openedAt: z.string(),
  closedAt: z.string().nullable(),

  symbol: z.string(),

  entries: z.array(EntryFillSchema),
  exits: z.array(ExitFillSchema),

  averageEntry: z.number(),
  realizedPnl: z.number(),
  realizedPnlPercent: z.number(),

  status: z.enum(["OPEN", "PARTIAL", "CLOSED"]),
});

export type EntryFill = z.infer<typeof EntryFillSchema>;
export type ExitFill = z.infer<typeof ExitFillSchema>;
export type Trade = z.infer<typeof TradeSchema>;
export type TradeStatus = Trade["status"];
