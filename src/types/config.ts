import { z } from "zod";

export const ExchangePermissionsSchema = z.object({
  read: z.boolean(),
  spotTrade: z.boolean(),
  withdraw: z.boolean(),
});

export const ExchangeConfigSchema = z.object({
  name: z.literal("binance"),
  apiKey: z.string(),
  apiSecret: z.string(),
  permissions: ExchangePermissionsSchema,
});

export const PreferencesSchema = z.object({
  cashReservePercent: z.number().min(0).max(1).default(0.2),
  maxAllocationPerTrade: z.number().min(0).max(1).default(0.1),
  defaultTimeframes: z.array(z.string()).default(["1h", "4h"]),
  topNCoins: z.number().min(1).max(500).default(50),
  /** Maximum number of concurrent active trades (default: 5) */
  maxConcurrentTrades: z.number().min(1).max(50).default(5),
});

/**
 * Memory configuration for agent system
 */
export const MemoryConfigSchema = z.object({
  /** Number of recent messages to keep in memory (default: 20) */
  lastMessages: z.number().min(5).max(100).default(20),
  /** Maximum session duration in hours before auto-clear (default: 24) */
  maxSessionDurationHours: z.number().min(1).max(168).default(24),
  /** Warning threshold for memory usage (0-1, default: 0.8 = 80%) */
  memoryWarningThreshold: z.number().min(0.5).max(0.95).default(0.8),
});

export const ProviderSchema = z.enum(["openai", "anthropic", "google", "dedalus"]);

export const ModelConfigSchema = z.object({
  provider: ProviderSchema.default("openai"),
  model: z.string().optional(), // If not set, uses provider's flagship model
});

export const GordonConfigSchema = z.object({
  version: z.string().default("1.0.0"),
  exchange: ExchangeConfigSchema.optional(),
  preferences: PreferencesSchema.default({
    cashReservePercent: 0.2,
    maxAllocationPerTrade: 0.1,
    defaultTimeframes: ["1h", "4h"],
    topNCoins: 50,
    maxConcurrentTrades: 5,
  }),
  memoryConfig: MemoryConfigSchema.default({
    lastMessages: 20,
    maxSessionDurationHours: 24,
    memoryWarningThreshold: 0.8,
  }),
  modelConfig: ModelConfigSchema.optional(),
  mode: z.enum(["SAFE", "ARMED"]).default("SAFE"),
  armedUntil: z.string().nullable().default(null),
  onboardingComplete: z.boolean().default(false),
});

export type ExchangePermissions = z.infer<typeof ExchangePermissionsSchema>;
export type ExchangeConfig = z.infer<typeof ExchangeConfigSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type ProviderName = z.infer<typeof ProviderSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type GordonConfig = z.infer<typeof GordonConfigSchema>;
export type Mode = GordonConfig["mode"];
