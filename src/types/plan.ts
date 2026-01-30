import { z } from "zod";

export const DCALevelSchema = z.object({
  price: z.number(),
  percentOfAllocation: z.number().min(0).max(1),
});

export const TakeProfitLevelSchema = z.object({
  price: z.number(),
  percentToSell: z.number().min(0).max(1),
});

export const GridLevelSchema = z.object({
  price: z.number(),
  percentOfAllocation: z.number().min(0).max(1),
});

export const GridConfigSchema = z.object({
  levels: z.array(GridLevelSchema).min(3).max(7),
  distribution: z.enum(["pyramid", "equal"]),
  priceRange: z.object({
    high: z.number(),
    low: z.number(),
  }),
});

export type GridLevel = z.infer<typeof GridLevelSchema>;
export type GridConfig = z.infer<typeof GridConfigSchema>;

export const PlanSchema = z.object({
  id: z.string(),
  createdAt: z.string(),

  symbol: z.string(),
  direction: z.literal("long"),
  strategy: z.enum([
    // Tier 1 - Beginner
    "support_bounce",
    "bollinger_bounce",
    "sma_crossover",
    "volume_surge",
    "vwap_bounce",
    // Tier 2 - Intermediate
    "consolidation_pop",
    "adx_trend",
    "ema_rsi_crossover",
    "relative_strength",
    "engulfing_pattern",
    // Special
    "grid_entry",
  ]),

  allocation: z.object({
    currency: z.literal("USDT"),
    amount: z.number(),
    percentOfPortfolio: z.number(),
  }),

  entry: z.object({
    type: z.enum(["limit", "market"]),
    price: z.number().nullable(),
  }),

  dca: z.array(DCALevelSchema).nullable(),

  grid: GridConfigSchema.nullable(),

  stopLoss: z.object({
    price: z.number(),
  }),

  takeProfit: z.array(TakeProfitLevelSchema),

  reasoning: z.string(),

  status: z.enum(["DRAFT", "APPROVED", "EXECUTING", "CLOSED", "CANCELLED"]),
});

export type DCALevel = z.infer<typeof DCALevelSchema>;
export type TakeProfitLevel = z.infer<typeof TakeProfitLevelSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type PlanStatus = Plan["status"];
