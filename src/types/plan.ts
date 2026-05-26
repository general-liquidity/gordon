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
  expiresAt: z.string().optional(),

  symbol: z.string(),
  direction: z.enum(["long", "short"]),
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

  /**
   * Optional operator mental-state capture at plan time. Soft signal that
   * compounds across sessions: once 30+ plans carry this, the discipline
   * audit can correlate emotional state with realized outcomes (do
   * anxious entries underperform calm ones for THIS operator). On plan
   * creation the field is also mirrored into the trade journal as an
   * observation entry so `/journal` surfaces it inline.
   */
  mentalState: z
    .object({
      confidence: z.number().min(1).max(10).optional(),
      focus: z.number().min(1).max(10).optional(),
      mood: z.enum(["calm", "anxious", "frustrated", "neutral", "overconfident"]).optional(),
      note: z.string().optional(),
    })
    .optional(),

  reasoning: z.string(),

  /**
   * Order routing policy. `maker_first` (default) keeps Gordon on the
   * passive side of the spread — fills wait, but the operator captures
   * the maker rebate / avoids the taker tax (Becker's 72.1M-trade
   * empirical edge: makers +1.12% vs takers −1.12%). `any` allows
   * crossing the spread without operator override. Enforced inside
   * verify_plan / execute_plan: a maker_first plan with entry.type=
   * "market" surfaces as a verify_plan violation that must be
   * acknowledged explicitly before approve_plan succeeds.
   */
  routingPolicy: z.enum(["maker_first", "any"]).optional(),

  /**
   * Snapshot of the synthesis inputs present at plan creation. Captures
   * the active regime, recent in-cache news, observation count on the
   * symbol, and ACE lesson IDs that mentioned the symbol. Process-local
   * by design — the value answers "what did THIS session see when it
   * decided to enter?" so a journal-review can replay the void around
   * the decision. Optional + best-effort: any subsystem can be null on
   * cold start. Not a backtest input; a provenance artifact.
   */
  synthesisManifest: z
    .object({
      capturedAt: z.number(),
      symbol: z.string(),
      regime: z
        .object({
          label: z.string(),
          confidence: z.number(),
          timeframe: z.string(),
        })
        .nullable(),
      news: z
        .object({
          headlinesCount: z.number(),
          netSentiment: z.number(),
          windowHoursApprox: z.number(),
          topBullish: z.string().optional(),
          topBearish: z.string().optional(),
        })
        .nullable(),
      observationCount: z.number(),
      observationWindowMs: z.number(),
      matchedLessonIds: z.array(z.string()),
    })
    .optional(),

  status: z.enum(["DRAFT", "APPROVED", "EXECUTING", "CLOSED", "CANCELLED"]),
});

export type DCALevel = z.infer<typeof DCALevelSchema>;
export type TakeProfitLevel = z.infer<typeof TakeProfitLevelSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type PlanStatus = Plan["status"];
