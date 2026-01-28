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
});

export const GordonConfigSchema = z.object({
  version: z.string().default("1.0.0"),
  exchange: ExchangeConfigSchema.optional(),
  preferences: PreferencesSchema.default({
    cashReservePercent: 0.2,
    maxAllocationPerTrade: 0.1,
    defaultTimeframes: ["1h", "4h"],
    topNCoins: 50,
  }),
  mode: z.enum(["SAFE", "ARMED"]).default("SAFE"),
  armedUntil: z.string().nullable().default(null),
  onboardingComplete: z.boolean().default(false),
});

export type ExchangePermissions = z.infer<typeof ExchangePermissionsSchema>;
export type ExchangeConfig = z.infer<typeof ExchangeConfigSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type GordonConfig = z.infer<typeof GordonConfigSchema>;
export type Mode = GordonConfig["mode"];
