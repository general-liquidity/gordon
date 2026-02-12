import { z } from "zod";

export const ExchangePermissionsSchema = z.object({
  read: z.boolean(),
  spotTrade: z.boolean(),
  withdraw: z.boolean(),
});

/**
 * Legacy exchange config schema (for backwards compatibility)
 * @deprecated Use MultiExchangeConfigSchema for new code
 */
export const ExchangeConfigSchema = z.object({
  name: z.literal("binance"),
  apiKey: z.string(),
  apiSecret: z.string(),
  permissions: ExchangePermissionsSchema,
});

/**
 * Supported exchange types for multi-exchange configuration
 */
export const ExchangeTypeSchema = z.enum(["binance", "coinbase", "kraken", "bitfinex", "hyperliquid"]);

/**
 * Multi-exchange configuration schema
 * Supports multiple exchange accounts with different types
 */
export const MultiExchangeConfigSchema = z.object({
  /** Unique identifier for this exchange configuration */
  id: z.string(),
  /** Exchange type */
  type: ExchangeTypeSchema,
  /** API key for authentication */
  apiKey: z.string(),
  /** API secret for authentication */
  apiSecret: z.string(),
  /** Whether this is the default/active exchange */
  isDefault: z.boolean().default(false),
  /** Use sandbox/testnet mode (optional) */
  sandbox: z.boolean().optional(),
  /** Optional passphrase for exchanges that require it (e.g., Coinbase) */
  passphrase: z.string().optional(),
  /** Wallet private key for DEX exchanges (e.g., Hyperliquid) */
  walletPrivateKey: z.string().optional(),
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

/**
 * MCP Server configuration schema
 * Configuration for individual MCP servers in the registry
 */
export const MCPServerConfigSchema = z.object({
  /** Server identifier (must match a registered server manifest) */
  id: z.string(),
  /** Whether this server is enabled */
  enabled: z.boolean().default(true),
  /** Priority for tool resolution (higher = preferred) */
  priority: z.number().optional(),
});

export const TelemetryConfigSchema = z.object({
  /** Whether anonymous telemetry is enabled (strict opt-in) */
  enabled: z.boolean().default(false),
  /** Whether anonymized trading data collection is enabled for AI model training (strict opt-in) */
  researchData: z.boolean().default(false),
});

export const GordonConfigSchema = z.object({
  version: z.string().default("1.0.0"),
  /** @deprecated Use `exchanges` array instead */
  exchange: ExchangeConfigSchema.optional(),
  /** Multi-exchange configuration (Phase 2+) */
  exchanges: z.array(MultiExchangeConfigSchema).default([]),
  /** ID of the currently active exchange from the exchanges array */
  activeExchangeId: z.string().optional(),
  /** Enable OS keyring for secure API key storage (opt-in) */
  useKeyring: z.boolean().default(false),
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
  /** MCP Server configurations */
  mcpServers: z.array(MCPServerConfigSchema).default([]),
  /** Anonymous telemetry configuration (strict opt-in) */
  telemetry: TelemetryConfigSchema.default({ enabled: false, researchData: false }),
});

export type ExchangePermissions = z.infer<typeof ExchangePermissionsSchema>;
/** @deprecated Use MultiExchangeConfig instead */
export type ExchangeConfig = z.infer<typeof ExchangeConfigSchema>;
export type ExchangeType = z.infer<typeof ExchangeTypeSchema>;
export type MultiExchangeConfig = z.infer<typeof MultiExchangeConfigSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type ProviderName = z.infer<typeof ProviderSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;
export type GordonConfig = z.infer<typeof GordonConfigSchema>;
export type Mode = GordonConfig["mode"];
