/**
 * Config Commands
 * CLI commands for viewing and editing Gordon configuration
 */

import { loadConfig, saveConfig } from "../../infra/storage/config/config.ts";
import { pluginInstaller } from "../../infra/ai/mcp/marketplace/installer.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a config command execution
 */
export interface ConfigCommandResult {
  /** Whether the command succeeded */
  success: boolean;
  /** Human-readable message */
  message: string;
  /** Additional data (command-specific) */
  data?: unknown;
}

/**
 * Supported quick-edit config keys
 */
type QuickEditKey =
  | "cash-reserve"
  | "max-per-trade"
  | "timeframes"
  | "top-coins"
  | "risk-mode"
  | "max-daily-loss"
  | "max-drawdown"
  | "max-position-size"
  | "max-positions"
  | "allocation-strategy"
  | "auto-regime";

/**
 * Config section that a key belongs to
 */
type ConfigSection = "preferences" | "riskManagement" | "strategyRuntime" | "regimeDetection";

/**
 * Mapping of quick-edit keys to config paths
 */
const QUICK_EDIT_KEYS: Record<
  QuickEditKey,
  {
    section: ConfigSection;
    path: string;
    parse: (value: string) => number | string[] | string | boolean;
    format: (value: number | string[] | string | boolean) => string;
    validate: (value: number | string[] | string | boolean) => string | null;
  }
> = {
  "cash-reserve": {
    section: "preferences",
    path: "cashReservePercent",
    parse: (v) => parsePercent(v),
    format: (v) => `${(v as number) * 100}%`,
    validate: (v) => {
      const n = v as number;
      if (Number.isNaN(n) || n < 0 || n > 1) return "Must be between 0% and 100%";
      return null;
    },
  },
  "max-per-trade": {
    section: "preferences",
    path: "maxAllocationPerTrade",
    parse: (v) => parsePercent(v),
    format: (v) => `${(v as number) * 100}%`,
    validate: (v) => {
      const n = v as number;
      if (Number.isNaN(n) || n < 0 || n > 1) return "Must be between 0% and 100%";
      return null;
    },
  },
  timeframes: {
    section: "preferences",
    path: "defaultTimeframes",
    parse: (v) =>
      v
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    format: (v) => (v as string[]).join(", "),
    validate: (v) => {
      const arr = v as string[];
      if (arr.length === 0) return "Must provide at least one timeframe";
      const validTimeframes = [
        "1m",
        "5m",
        "15m",
        "30m",
        "1h",
        "2h",
        "4h",
        "6h",
        "8h",
        "12h",
        "1d",
        "3d",
        "1w",
        "1M",
      ];
      for (const tf of arr) {
        if (!validTimeframes.includes(tf)) {
          return `Invalid timeframe: ${tf}. Valid: ${validTimeframes.join(", ")}`;
        }
      }
      return null;
    },
  },
  "top-coins": {
    section: "preferences",
    path: "topNCoins",
    parse: (v) => parseInt(v, 10),
    format: (v) => String(v),
    validate: (v) => {
      const n = v as number;
      if (Number.isNaN(n) || n < 1 || n > 500) return "Must be between 1 and 500";
      return null;
    },
  },
  "risk-mode": {
    section: "riskManagement",
    path: "mode",
    parse: (v) => v.toLowerCase().trim(),
    format: (v) => String(v),
    validate: (v) => {
      const valid = ["enforce", "warn", "paper"];
      if (!valid.includes(v as string)) return `Must be one of: ${valid.join(", ")}`;
      return null;
    },
  },
  "max-daily-loss": {
    section: "riskManagement",
    path: "maxDailyLossPercent",
    parse: (v) => parseWholePercent(v),
    format: (v) => `${v}%`,
    validate: (v) => {
      const n = v as number;
      if (Number.isNaN(n) || n < 0 || n > 100) return "Must be between 0% and 100%";
      return null;
    },
  },
  "max-drawdown": {
    section: "riskManagement",
    path: "maxDrawdownPercent",
    parse: (v) => parseWholePercent(v),
    format: (v) => `${v}%`,
    validate: (v) => {
      const n = v as number;
      if (Number.isNaN(n) || n < 0 || n > 100) return "Must be between 0% and 100%";
      return null;
    },
  },
  "max-position-size": {
    section: "riskManagement",
    path: "maxPositionSizePercent",
    parse: (v) => parseWholePercent(v),
    format: (v) => `${v}%`,
    validate: (v) => {
      const n = v as number;
      if (Number.isNaN(n) || n < 0 || n > 100) return "Must be between 0% and 100%";
      return null;
    },
  },
  "max-positions": {
    section: "riskManagement",
    path: "maxPositions",
    parse: (v) => parseInt(v, 10),
    format: (v) => String(v),
    validate: (v) => {
      const n = v as number;
      if (Number.isNaN(n) || !Number.isInteger(n) || n < 1 || n > 100)
        return "Must be an integer between 1 and 100";
      return null;
    },
  },
  "allocation-strategy": {
    section: "strategyRuntime",
    path: "allocationStrategy",
    parse: (v) => v.toLowerCase().trim().replace(/\s+/g, "_"),
    format: (v) => String(v),
    validate: (v) => {
      const valid = ["equal_weight", "risk_parity", "performance", "fixed"];
      if (!valid.includes(v as string)) return `Must be one of: ${valid.join(", ")}`;
      return null;
    },
  },
  "auto-regime": {
    section: "regimeDetection",
    path: "autoRegime",
    parse: (v) => {
      const lower = v.toLowerCase().trim();
      return ["enabled", "on", "true", "1"].includes(lower);
    },
    format: (v) => ((v as boolean) ? "enabled" : "disabled"),
    validate: (v) => {
      // Already parsed as boolean, always valid
      if (typeof v !== "boolean") return "Must be enabled/disabled, on/off, or true/false";
      return null;
    },
  },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse a percentage value (e.g., "25%" or "0.25") to decimal (0-1 range)
 */
function parsePercent(value: string): number {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    return parseFloat(trimmed.slice(0, -1)) / 100;
  }
  return parseFloat(trimmed);
}

/**
 * Parse a percentage value to a whole number (0-100 range).
 * Accepts "5%", "5", "0.05" (interpreted as 5%).
 */
function parseWholePercent(value: string): number {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    return parseFloat(trimmed.slice(0, -1));
  }
  const num = parseFloat(trimmed);
  // If the value is between 0 and 1 (exclusive), treat as decimal percentage
  if (num > 0 && num < 1) {
    return num * 100;
  }
  return num;
}

/**
 * Format permissions for display
 */
function _formatPermissions(read: boolean, spotTrade: boolean): string {
  const perms: string[] = [];
  if (read) perms.push("read");
  if (spotTrade) perms.push("spot");
  return perms.length > 0 ? perms.join(", ") : "none";
}

// ============================================================================
// Command Implementations
// ============================================================================

/**
 * View all current configuration settings
 * Usage: /config
 */
export async function configView(): Promise<ConfigCommandResult> {
  try {
    const config = await loadConfig();

    // Build Trading Preferences section
    const prefs = config.preferences;
    const tradingLines = [
      "=== Trading Preferences ===",
      `Cash Reserve: ${(prefs.cashReservePercent * 100).toFixed(0)}%`,
      `Max Per Trade: ${(prefs.maxAllocationPerTrade * 100).toFixed(0)}%`,
      `Default Timeframes: ${prefs.defaultTimeframes.join(", ")}`,
      `Top Coins to Scan: ${prefs.topNCoins}`,
      `Max Concurrent Trades: ${prefs.maxConcurrentTrades}`,
    ];

    // Build API Status section
    const apiLines = ["", "=== API Status ==="];

    const hasExchange = config.exchanges && config.exchanges.length > 0;

    if (hasExchange) {
      const activeExchange =
        config.exchanges.find((e) => e.id === config.activeExchangeId) ||
        config.exchanges.find((e) => e.isDefault) ||
        config.exchanges[0];
      if (activeExchange) {
        apiLines.push(`${activeExchange.type}: Connected`);
      }
    } else {
      apiLines.push("Exchange: Not configured");
    }

    // Check LLM status
    if (config.modelConfig) {
      const provider = config.modelConfig.provider;
      const model = config.modelConfig.model || "default";
      apiLines.push(`LLM Provider: ${provider} (model: ${model})`);
    } else {
      apiLines.push("LLM Provider: Not configured");
    }

    // Build Exchanges section
    const exchangeLines = ["", "=== Exchanges ==="];
    if (hasExchange && config.exchanges.length > 0) {
      const activeId = config.activeExchangeId || config.exchanges.find((e) => e.isDefault)?.id;
      const activeType = config.exchanges.find((e) => e.id === activeId)?.type || "none";
      const configuredTypes = [...new Set(config.exchanges.map((e) => e.type))];
      exchangeLines.push(`Active: ${activeType}`);
      exchangeLines.push(`Configured: ${configuredTypes.join(", ")}`);
    } else {
      exchangeLines.push("Active: none");
      exchangeLines.push("Configured: none");
    }

    // Build MCP Plugins section
    const mcpLines = ["", "=== MCP Plugins ==="];
    try {
      await pluginInstaller.initialize();
      const installed = pluginInstaller.getInstalled();
      const enabled = installed.filter((p) => p.enabled).length;
      mcpLines.push(`Installed: ${installed.length} (${enabled} enabled)`);
    } catch {
      mcpLines.push("Installed: Unable to load plugin data");
    }

    // Build System section
    const systemLines = ["", "=== System ==="];
    systemLines.push(`Permission Mode: ${config.permissionMode}`);
    systemLines.push(`Onboarding Complete: ${config.onboardingComplete ? "Yes" : "No"}`);
    systemLines.push(`Startup Banner: ${config.startupBannerMode}`);

    // Build Risk Management section (v0.7)
    const risk = config.riskManagement;
    const riskLines = ["", "=== Risk Management ==="];
    riskLines.push(`Risk Mode: ${risk.mode} (enforce/warn/paper)`);
    riskLines.push(`Max Daily Loss: ${risk.maxDailyLossPercent}%`);
    riskLines.push(`Max Drawdown: ${risk.maxDrawdownPercent}%`);
    riskLines.push(`Max Position Size: ${risk.maxPositionSizePercent}%`);
    riskLines.push(`Max Positions: ${risk.maxPositions}`);

    // Build Strategy Runtime section (v0.7)
    const runtime = config.strategyRuntime;
    const runtimeLines = ["", "=== Strategy Runtime ==="];
    runtimeLines.push(
      `Allocation: ${runtime.allocationStrategy} (equal_weight/risk_parity/performance/fixed)`,
    );
    try {
      const { strategyRuntime: runtimeInstance } = await import("../../core/runtime/index.ts");
      const activeSlots = runtimeInstance.getActiveSlots();
      const portfolio = runtimeInstance.getPortfolioState();
      runtimeLines.push(
        `Total Capital: ${portfolio.total_capital > 0 ? `$${portfolio.total_capital.toFixed(2)}` : "(from exchange)"}`,
      );
      runtimeLines.push(`Active Slots: ${activeSlots.length}`);
    } catch {
      runtimeLines.push("Total Capital: (from exchange)");
      runtimeLines.push("Active Slots: 0");
    }

    // Build Regime Detection section (v0.7)
    const regime = config.regimeDetection;
    const regimeLines = ["", "=== Regime Detection ==="];
    regimeLines.push(
      `Auto-Regime: ${regime.autoRegime ? "enabled" : "disabled"} (enable/disable automatic regime matching)`,
    );

    // Combine all sections
    const output = [
      ...tradingLines,
      ...apiLines,
      ...exchangeLines,
      ...mcpLines,
      ...systemLines,
      ...riskLines,
      ...runtimeLines,
      ...regimeLines,
    ].join("\n");

    return {
      success: true,
      message: output,
      data: { config },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Quick edit a configuration setting
 * Usage: /config set <key> <value>
 */
export async function configSet(key: string, value: string): Promise<ConfigCommandResult> {
  // Normalize key
  const normalizedKey = key.toLowerCase().trim() as QuickEditKey;

  // Validate key
  if (!(normalizedKey in QUICK_EDIT_KEYS)) {
    const validKeys = Object.keys(QUICK_EDIT_KEYS).join(", ");
    return {
      success: false,
      message: `Unknown setting: "${key}". Valid keys: ${validKeys}`,
    };
  }

  const keyConfig = QUICK_EDIT_KEYS[normalizedKey];

  try {
    // Parse value
    const parsedValue = keyConfig.parse(value);

    // Validate value
    const validationError = keyConfig.validate(parsedValue);
    if (validationError) {
      return {
        success: false,
        message: `Invalid value for ${key}: ${validationError}`,
      };
    }

    // Load current config
    const config = await loadConfig();

    // Get the config section and old value
    const section = keyConfig.section;
    const sectionObj = config[section] as Record<string, unknown>;
    const oldValue = sectionObj[keyConfig.path];
    const oldFormatted = keyConfig.format(oldValue as number | string[] | string | boolean);

    // Update the value in the correct section
    sectionObj[keyConfig.path] = parsedValue;

    // Save config
    await saveConfig(config);

    // Format new value for display
    const newFormatted = keyConfig.format(parsedValue);

    return {
      success: true,
      message: `Updated ${key}: ${oldFormatted} -> ${newFormatted}`,
      data: {
        key: normalizedKey,
        oldValue: oldFormatted,
        newValue: newFormatted,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to update setting: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Reset configuration to defaults
 * Usage: /config reset
 */
export async function configReset(): Promise<ConfigCommandResult> {
  try {
    const config = await loadConfig();

    // Store old preferences for display
    const oldPrefs = { ...config.preferences };

    // Reset preferences to defaults
    config.preferences = {
      cashReservePercent: 0.2,
      maxAllocationPerTrade: 0.1,
      defaultTimeframes: ["1h", "4h"],
      topNCoins: 50,
      maxConcurrentTrades: 5,
    };

    // Save config
    await saveConfig(config);

    const changes = [
      `Cash Reserve: ${(oldPrefs.cashReservePercent * 100).toFixed(0)}% -> 20%`,
      `Max Per Trade: ${(oldPrefs.maxAllocationPerTrade * 100).toFixed(0)}% -> 10%`,
      `Timeframes: ${oldPrefs.defaultTimeframes.join(", ")} -> 1h, 4h`,
      `Top Coins: ${oldPrefs.topNCoins} -> 50`,
      `Max Concurrent: ${oldPrefs.maxConcurrentTrades} -> 5`,
    ];

    return {
      success: true,
      message: `Configuration reset to defaults:\n${changes.join("\n")}`,
      data: {
        oldPreferences: oldPrefs,
        newPreferences: config.preferences,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to reset configuration: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Command Router
// ============================================================================

/**
 * Handle config command routing
 * @param args - Command arguments string (e.g., "", "set cash-reserve 25%", "reset")
 */
export async function handleConfigCommand(args: string): Promise<ConfigCommandResult> {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? "";

  switch (subcommand) {
    case "":
    case "view":
    case "show":
      return configView();

    case "set":
      if (parts.length < 3) {
        return {
          success: false,
          message:
            "Usage: /config set <key> <value>\n\nAvailable keys:\n" +
            "  cash-reserve      - Cash reserve percentage (e.g., 25%)\n" +
            "  max-per-trade     - Max allocation per trade (e.g., 15%)\n" +
            "  timeframes        - Default timeframes (e.g., 4h,1d)\n" +
            "  top-coins         - Number of coins to scan (e.g., 100)\n" +
            "  risk-mode         - Risk enforcement mode (enforce/warn/paper)\n" +
            "  max-daily-loss    - Max daily loss percentage (e.g., 5%)\n" +
            "  max-drawdown      - Max portfolio drawdown (e.g., 15%)\n" +
            "  max-position-size - Max single position size (e.g., 10%)\n" +
            "  max-positions     - Max number of open positions (e.g., 5)\n" +
            "  allocation-strategy - Capital allocation strategy (equal_weight/risk_parity/performance/fixed)\n" +
            "  auto-regime       - Automatic regime matching (enabled/disabled)",
        };
      }
      return configSet(parts[1]!, parts.slice(2).join(" "));

    case "reset":
      return configReset();

    case "help":
      return {
        success: true,
        message: `Config Command Help:
  /config               - View all current settings
  /config view          - View all current settings
  /config set <key> <value>  - Quick edit a setting
  /config reset         - Reset preferences to defaults

Available quick-edit keys:
  cash-reserve        - Cash reserve percentage (e.g., /config set cash-reserve 25%)
  max-per-trade       - Max allocation per trade (e.g., /config set max-per-trade 15%)
  timeframes          - Default timeframes (e.g., /config set timeframes 4h,1d)
  top-coins           - Number of coins to scan (e.g., /config set top-coins 100)
  risk-mode           - Risk enforcement mode (e.g., /config set risk-mode warn)
  max-daily-loss      - Max daily loss percentage (e.g., /config set max-daily-loss 5%)
  max-drawdown        - Max portfolio drawdown (e.g., /config set max-drawdown 15%)
  max-position-size   - Max single position size (e.g., /config set max-position-size 10%)
  max-positions       - Max open positions (e.g., /config set max-positions 5)
  allocation-strategy - Capital allocation (e.g., /config set allocation-strategy risk_parity)
  auto-regime         - Auto regime matching (e.g., /config set auto-regime enabled)

Examples:
  /config set cash-reserve 25%
  /config set max-per-trade 0.15
  /config set timeframes 1h,4h,1d
  /config set top-coins 100
  /config set risk-mode paper
  /config set max-daily-loss 5%
  /config set allocation-strategy performance
  /config set auto-regime disabled`,
      };

    default:
      return {
        success: false,
        message: `Unknown subcommand: ${subcommand}. Use "/config help" for available commands.`,
      };
  }
}
