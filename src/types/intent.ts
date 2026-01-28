import { z } from "zod";

export const ExploreIntentSchema = z.object({
  type: z.literal("EXPLORE"),
  params: z.object({
    scope: z.enum(["top50", "watchlist", "specific"]).optional(),
    symbol: z.string().optional(),
  }),
});

export const AnalyzeIntentSchema = z.object({
  type: z.literal("ANALYZE"),
  params: z.object({
    symbol: z.string(),
  }),
});

export const PlanIntentSchema = z.object({
  type: z.literal("PLAN"),
  params: z.object({
    riskLevel: z.enum(["low", "medium", "high"]).optional(),
    amount: z.number().optional(),
    symbol: z.string().optional(),
  }),
});

export const ExecuteIntentSchema = z.object({
  type: z.literal("EXECUTE"),
  params: z.object({
    planId: z.string(),
  }),
});

export const MonitorIntentSchema = z.object({
  type: z.literal("MONITOR"),
  params: z.object({
    scope: z.enum(["all", "specific"]),
    tradeId: z.string().optional(),
  }),
});

export const ProtectIntentSchema = z.object({
  type: z.literal("PROTECT"),
  params: z.object({
    action: z.enum(["close_all", "close_one", "reduce"]),
    tradeId: z.string().optional(),
  }),
});

export const LearnIntentSchema = z.object({
  type: z.literal("LEARN"),
  params: z.object({
    about: z.string(),
  }),
});

export const SettingsIntentSchema = z.object({
  type: z.literal("SETTINGS"),
  params: z.object({
    action: z.string(),
  }),
});

export const UnclearIntentSchema = z.object({
  type: z.literal("UNCLEAR"),
  params: z.object({
    originalMessage: z.string(),
  }),
});

export const IntentSchema = z.discriminatedUnion("type", [
  ExploreIntentSchema,
  AnalyzeIntentSchema,
  PlanIntentSchema,
  ExecuteIntentSchema,
  MonitorIntentSchema,
  ProtectIntentSchema,
  LearnIntentSchema,
  SettingsIntentSchema,
  UnclearIntentSchema,
]);

export type ExploreIntent = z.infer<typeof ExploreIntentSchema>;
export type AnalyzeIntent = z.infer<typeof AnalyzeIntentSchema>;
export type PlanIntent = z.infer<typeof PlanIntentSchema>;
export type ExecuteIntent = z.infer<typeof ExecuteIntentSchema>;
export type MonitorIntent = z.infer<typeof MonitorIntentSchema>;
export type ProtectIntent = z.infer<typeof ProtectIntentSchema>;
export type LearnIntent = z.infer<typeof LearnIntentSchema>;
export type SettingsIntent = z.infer<typeof SettingsIntentSchema>;
export type UnclearIntent = z.infer<typeof UnclearIntentSchema>;
export type Intent = z.infer<typeof IntentSchema>;
export type IntentType = Intent["type"];
