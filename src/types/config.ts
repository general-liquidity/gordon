import { z } from "zod";

/**
 * Canonical exchange type — always `ccxt:<sub-id>`. Bare first-class ids
 * (e.g. "binance") are migrated on config load via `migrateExchangeConfigTypes`.
 */
export const CCXT_TYPE_PATTERN = /^ccxt:[a-z0-9_]+$/;
export const ExchangeTypeSchema = z.custom<`ccxt:${string}`>((val) => {
  if (typeof val !== "string") return false;
  return CCXT_TYPE_PATTERN.test(val);
}, "Must be 'ccxt:<lowercase-sub-id>' (e.g. 'ccxt:binance', 'ccxt:bybit')");

function isConfigRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rewriteExchangeEntry(entry: unknown): unknown {
  if (!isConfigRecord(entry)) return entry;
  if (typeof entry.type !== "string") return entry;
  if (CCXT_TYPE_PATTERN.test(entry.type)) return entry;
  const subId = entry.type === "binance_us" ? "binanceus" : entry.type;
  return { ...entry, type: `ccxt:${subId}` };
}

/**
 * Rewrite legacy config shapes before parse:
 * - singleton `exchange` → `exchanges[]` entry
 * - bare exchange `type` values → `ccxt:<subId>`
 */
export function migrateExchangeConfigTypes(raw: Record<string, unknown>): Record<string, unknown> {
  let migrated: Record<string, unknown> = { ...raw };
  const exchanges = Array.isArray(migrated.exchanges)
    ? [...migrated.exchanges]
    : [];

  if (isConfigRecord(migrated.exchange)) {
    const legacy = migrated.exchange;
    const apiKey = legacy.apiKey;
    const apiSecret = legacy.apiSecret;
    const alreadyPresent = exchanges.some(
      (entry) => isConfigRecord(entry)
        && (entry.type === "ccxt:binance" || entry.type === "binance" || entry.id === "binance"),
    );
    if (
      !alreadyPresent
      && typeof apiKey === "string"
      && typeof apiSecret === "string"
    ) {
      exchanges.push({
        id: "binance",
        type: "ccxt:binance",
        apiKey,
        apiSecret,
        isDefault: exchanges.length === 0,
      });
      if (typeof migrated.activeExchangeId !== "string") {
        migrated.activeExchangeId = "binance";
      }
    }
    const { exchange: _legacy, ...rest } = migrated;
    migrated = rest;
  }

  return {
    ...migrated,
    exchanges: exchanges.map(rewriteExchangeEntry),
  };
}

/**
 * Supported stock broker types
 */
export const BrokerTypeSchema = z.enum([
  "alpaca",
  "webull",
  "schwab",
  "tradier",
  "tradestation",
  "tastytrade",
  "trading212",
  "etrade",
  "ibkr",
  "syphonix",
]);

/**
 * Agent rails provider types
 * Native wallet, chain-data, and payments rails that sit alongside exchanges/brokers.
 */
export const RailAuthModeSchema = z.enum(["native", "mcp", "hybrid"]);
export const WalletProviderTypeSchema = z.enum(["moonpay"]);
export const ChainProviderTypeSchema = z.enum(["helius"]);
export const PaymentProviderTypeSchema = z.enum(["polygon"]);

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

/**
 * Multi-broker configuration schema
 * Supports stock/options brokers with API key + secret auth.
 */
export const MultiBrokerConfigSchema = z.object({
  /** Unique identifier for this broker configuration */
  id: z.string(),
  /** Broker type */
  type: BrokerTypeSchema,
  /** API key for authentication */
  apiKey: z.string(),
  /** API secret for authentication */
  apiSecret: z.string(),
  /** Optional account identifier for broker APIs that require it */
  accountId: z.string().optional(),
  /** Whether this is the default/active broker */
  isDefault: z.boolean().default(false),
  /** Paper trading mode */
  paper: z.boolean().default(true),
  /** Optional override for trading API host */
  baseUrl: z.string().url().optional(),
  /** Optional override for market data API host */
  dataBaseUrl: z.string().url().optional(),
});

export const WalletProviderConfigSchema = z.object({
  id: z.string(),
  type: WalletProviderTypeSchema,
  authMode: RailAuthModeSchema.default("native"),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  walletAddress: z.string().optional(),
  customerId: z.string().optional(),
  externalCustomerId: z.string().optional(),
  email: z.string().email().optional(),
  network: z.string().optional(),
  redirectUrl: z.string().url().optional(),
  apiBaseUrl: z.string().url().optional(),
  mcpServerId: z.string().optional(),
});

export const ChainProviderConfigSchema = z.object({
  id: z.string(),
  type: ChainProviderTypeSchema,
  authMode: RailAuthModeSchema.default("native"),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  network: z.string().default("solana"),
  apiBaseUrl: z.string().url().optional(),
  mcpServerId: z.string().optional(),
});

export const PaymentProviderConfigSchema = z.object({
  id: z.string(),
  type: PaymentProviderTypeSchema,
  authMode: RailAuthModeSchema.default("native"),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  network: z.string().default("polygon"),
  facilitatorUrl: z.string().url().optional(),
  recipient: z.string().optional(),
  mcpServerId: z.string().optional(),
});

export const AgentRailsConfigSchema = z.object({
  walletProviders: z.array(WalletProviderConfigSchema).default([]),
  activeWalletProviderId: z.string().optional(),
  chainProviders: z.array(ChainProviderConfigSchema).default([]),
  activeChainProviderId: z.string().optional(),
  paymentProviders: z.array(PaymentProviderConfigSchema).default([]),
  activePaymentProviderId: z.string().optional(),
  autoSyncMcpPlugins: z.boolean().default(true),
  requireApprovalForExternalActions: z.boolean().default(true),
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

export const ProviderSchema = z.enum(["openai", "anthropic", "google", "inception", "dedalus"]);

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

/**
 * Risk management configuration (v0.7)
 * Persisted overrides for the Risk Kernel defaults
 */
export const RiskManagementConfigSchema = z.object({
  /** Behavior mode: enforce blocks trades, warn allows with warning, paper simulates */
  mode: z.enum(["enforce", "warn", "paper"]).default("enforce"),
  /** Maximum daily loss as a percentage (0-100) */
  maxDailyLossPercent: z.number().min(0).max(100).default(3),
  /** Maximum portfolio drawdown before trading halts (0-100) */
  maxDrawdownPercent: z.number().min(0).max(100).default(15),
  /** Maximum single position size as a percentage of portfolio (0-100) */
  maxPositionSizePercent: z.number().min(0).max(100).default(10),
  /** Maximum number of open positions */
  maxPositions: z.number().int().min(1).max(100).default(5),
});

/**
 * Strategy runtime configuration (v0.7)
 * Persisted settings for the composable strategy runtime
 */
export const StrategyRuntimeConfigSchema = z.object({
  /** Capital allocation strategy across active slots */
  allocationStrategy: z.enum(["equal_weight", "risk_parity", "performance", "fixed"]).default("equal_weight"),
});

/**
 * Regime detection configuration (v0.7)
 * Controls automatic market regime matching for playbooks
 */
export const RegimeDetectionConfigSchema = z.object({
  /** Whether automatic regime matching is enabled */
  autoRegime: z.boolean().default(true),
});

/**
 * Systematic trading configuration.
 * Controls how strictly Gordon enforces research/validation discipline.
 */
export const SystematicTradingConfigSchema = z.object({
  executionMode: z
    .enum(["assisted", "semi_systematic", "strict_systematic"])
    .default("assisted"),
  minTradesForPromotion: z.number().int().min(1).default(30),
  minValidationScore: z.number().min(0).max(100).default(60),
  autoSnapshotDatasets: z.boolean().default(true),
  autoCreateResearchExperiments: z.boolean().default(true),
  simulationRealism: z.object({
    profile: z.enum(["baseline", "realistic", "conservative"]).default("realistic"),
    executionLagBars: z.number().int().min(0).max(3).default(1),
    spreadBps: z.number().min(0).max(50).default(2),
    marketImpactBps: z.number().min(0).max(50).default(1),
  }).default({
    profile: "realistic",
    executionLagBars: 1,
    spreadBps: 2,
    marketImpactBps: 1,
  }),
  biasDiagnostics: z.object({
    minBacktestDays: z.number().int().min(7).default(90),
    minOutOfSampleWindows: z.number().int().min(1).default(3),
    maxTradePnlConcentrationPercent: z.number().min(10).max(100).default(55),
    maxCagrPercent: z.number().min(20).max(2000).default(300),
    requireWalkForward: z.boolean().default(true),
    requireMonteCarlo: z.boolean().default(true),
  }).default({
    minBacktestDays: 90,
    minOutOfSampleWindows: 3,
    maxTradePnlConcentrationPercent: 55,
    maxCagrPercent: 300,
    requireWalkForward: true,
    requireMonteCarlo: true,
  }),
});

export const GordonConfigSchema = z.object({
  version: z.string().default("1.0.0"),
  activeProfile: z.string().min(1).optional(),
  /** Multi-exchange configuration */
  exchanges: z.array(MultiExchangeConfigSchema).default([]),
  /** ID of the currently active exchange from the exchanges array */
  activeExchangeId: z.string().optional(),
  /** Multi-broker configuration (stocks/options) */
  brokers: z.array(MultiBrokerConfigSchema).default([]),
  /** ID of the currently active broker from the brokers array */
  activeBrokerId: z.string().optional(),
  /** Wallet, chain-data, and payment rails used alongside exchanges/brokers */
  agentRails: AgentRailsConfigSchema.default({
    walletProviders: [],
    chainProviders: [],
    paymentProviders: [],
    autoSyncMcpPlugins: true,
    requireApprovalForExternalActions: true,
  }),
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
  /**
   * Permission mode — how Gordon gates trade-impacting actions.
   *   - "auto":    trade tools execute without per-action approval
   *   - "ask":     each trade requires ApprovalDialog confirmation (default)
   *   - "strict":  read-only — trade tools blocked entirely
   *   - "paper":   paper trading only — real orders blocked, simulated fills allowed
   *   - "observe": pure observation — no execution of any kind
   *   - "plan":    planning only — can create plans but not execute them
   */
  permissionMode: z.enum(["auto", "ask", "strict", "paper", "observe", "plan"]).default("ask"),
  onboardingComplete: z.boolean().default(false),
  startupBannerMode: z.enum(["full", "quiet"]).default("full"),
  /** MCP Server configurations */
  mcpServers: z.array(MCPServerConfigSchema).default([]),
  /** Anonymous telemetry configuration (strict opt-in) */
  telemetry: TelemetryConfigSchema.default({ enabled: false, researchData: false }),
  /**
   * Per-session and per-day cost budgets. When `action` is "warn", crossing
   * a threshold logs and emits a warning event but never blocks. When
   * "halt", crossing the 100% line halts further model calls until the
   * user resets via /cost reset or starts a new day.
   */
  costBudget: z
    .object({
      sessionUsd: z.number().nonnegative().optional(),
      dailyUsd: z.number().nonnegative().optional(),
      action: z.enum(["warn", "halt"]).default("warn"),
      warnThresholds: z.array(z.number().min(0).max(1)).default([0.5, 0.75, 0.9]),
    })
    .default({ action: "warn", warnThresholds: [0.5, 0.75, 0.9] }),
  /** Risk management configuration (v0.7) */
  riskManagement: RiskManagementConfigSchema.default({
    mode: "enforce",
    maxDailyLossPercent: 3,
    maxDrawdownPercent: 15,
    maxPositionSizePercent: 10,
    maxPositions: 5,
  }),
  /** Strategy runtime configuration (v0.7) */
  strategyRuntime: StrategyRuntimeConfigSchema.default({
    allocationStrategy: "equal_weight",
  }),
  /** Regime detection configuration (v0.7) */
  regimeDetection: RegimeDetectionConfigSchema.default({
    autoRegime: true,
  }),
  /** Systematic trading research and promotion controls */
  systematic: SystematicTradingConfigSchema.default({
    executionMode: "assisted",
    minTradesForPromotion: 30,
    minValidationScore: 60,
    autoSnapshotDatasets: true,
    autoCreateResearchExperiments: true,
    simulationRealism: {
      profile: "realistic",
      executionLagBars: 1,
      spreadBps: 2,
      marketImpactBps: 1,
    },
    biasDiagnostics: {
      minBacktestDays: 90,
      minOutOfSampleWindows: 3,
      maxTradePnlConcentrationPercent: 55,
      maxCagrPercent: 300,
      requireWalkForward: true,
      requireMonteCarlo: true,
    },
  }),
});

export type ExchangeType = z.infer<typeof ExchangeTypeSchema>;
export type MultiExchangeConfig = z.infer<typeof MultiExchangeConfigSchema>;
export type BrokerType = z.infer<typeof BrokerTypeSchema>;
export type MultiBrokerConfig = z.infer<typeof MultiBrokerConfigSchema>;
export type RailAuthMode = z.infer<typeof RailAuthModeSchema>;
export type WalletProviderType = z.infer<typeof WalletProviderTypeSchema>;
export type ChainProviderType = z.infer<typeof ChainProviderTypeSchema>;
export type PaymentProviderType = z.infer<typeof PaymentProviderTypeSchema>;
export type WalletProviderConfig = z.infer<typeof WalletProviderConfigSchema>;
export type ChainProviderConfig = z.infer<typeof ChainProviderConfigSchema>;
export type PaymentProviderConfig = z.infer<typeof PaymentProviderConfigSchema>;
export type AgentRailsConfig = z.infer<typeof AgentRailsConfigSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type ProviderName = z.infer<typeof ProviderSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;
export type RiskManagementConfig = z.infer<typeof RiskManagementConfigSchema>;
export type StrategyRuntimeConfig = z.infer<typeof StrategyRuntimeConfigSchema>;
export type RegimeDetectionConfig = z.infer<typeof RegimeDetectionConfigSchema>;
export type SystematicTradingConfig = z.infer<typeof SystematicTradingConfigSchema>;
export type GordonConfig = z.infer<typeof GordonConfigSchema>;
export type PermissionMode = GordonConfig["permissionMode"];
