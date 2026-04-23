/**
 * Broker Commands
 * CLI commands for managing stock/options brokers
 *
 * Commands:
 * - /broker list             - Show configured brokers
 * - /broker add <type>       - Add new broker (launches setup)
 * - /broker switch <id>      - Switch active broker
 * - /broker remove <id>      - Remove a broker
 * - /broker status           - Show connection status for all
 */

import { loadConfig, saveConfig } from "../../infra/storage/config.ts";
import { BrokerFactory } from "../../infra/broker/factory.ts";
import { resolveBrokerCredentials, type BrokerId } from "../../infra/broker/types.ts";
import type { GordonConfig, MultiBrokerConfig } from "../../types/index.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { refreshRuntimeCredentials } from "../../infra/runtime/credentialRefresh.ts";

const logger = createModuleLogger("broker-commands");

export interface BrokerCommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

function generateBrokerId(type: BrokerId, brokers: MultiBrokerConfig[]): string {
  const baseId = type;
  let id: string = baseId;
  let counter = 1;

  while (brokers.some((broker) => broker.id === id)) {
    id = `${baseId}_${counter}`;
    counter += 1;
  }

  return id;
}

export async function brokerList(): Promise<BrokerCommandResult> {
  try {
    const config = await loadConfig();
    const brokers = config.brokers || [];

    if (brokers.length === 0) {
      return {
        success: true,
        message: 'No brokers configured. Use "/broker add <type>" to add one.',
        data: { brokers: [], activeId: null },
      };
    }

    return {
      success: true,
      message: `${brokers.length} broker(s) configured`,
      data: {
        brokers: brokers.map((broker) => ({
          id: broker.id,
          type: broker.type,
          isDefault: broker.isDefault,
          isActive: broker.id === config.activeBrokerId,
          paper: broker.paper ?? true,
          keyPrefix: broker.apiKey?.substring(0, 8) || "",
        })),
        activeId: config.activeBrokerId || null,
        supportedTypes: BrokerFactory.getSupportedBrokers(),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to list brokers: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function brokerAdd(brokerType: string): Promise<BrokerCommandResult> {
  try {
    if (!BrokerFactory.isSupported(brokerType)) {
      return {
        success: false,
        message: `Unsupported broker type: "${brokerType}". Supported: ${BrokerFactory.getSupportedBrokers().join(", ")}`,
        data: { supportedTypes: BrokerFactory.getSupportedBrokers() },
      };
    }

    const config = await loadConfig();
    const brokers = config.brokers || [];
    const type = brokerType as BrokerId;
    const suggestedId = generateBrokerId(type, brokers);
    const existingCount = brokers.filter((broker) => broker.type === type).length;

    return {
      success: true,
      message: `Ready to add ${type} broker. Provide API key and secret in /setup.`,
      data: {
        brokerType: type,
        suggestedId,
        existingCount,
        requiredFields: ["apiKey", "apiSecret"],
        optionalFields: ["paper", "accountId"],
        instructions: getBrokerSetupInstructions(type),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to prepare broker add: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function brokerSwitch(brokerId: string): Promise<BrokerCommandResult> {
  try {
    const config = await loadConfig();
    const brokers = config.brokers || [];
    const broker = brokers.find((entry) => entry.id === brokerId);

    if (!broker) {
      const available = brokers.map((entry) => entry.id);
      return {
        success: false,
        message: `Broker "${brokerId}" not found. Available: ${available.length > 0 ? available.join(", ") : "none"}`,
        data: { availableIds: available },
      };
    }

    const updatedConfig: GordonConfig = {
      ...config,
      activeBrokerId: broker.id,
      brokers: brokers.map((entry) => ({
        ...entry,
        isDefault: entry.id === broker.id,
      })),
    };
    await saveConfig(updatedConfig);
    await refreshRuntimeCredentials();

    logger.info("Switched active broker", { brokerId, type: broker.type, paper: broker.paper ?? true });

    return {
      success: true,
      message: `Switched to broker "${broker.id}" (${broker.type})`,
      data: {
        activeBroker: {
          id: broker.id,
          type: broker.type,
          paper: broker.paper ?? true,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to switch broker: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function brokerRemove(brokerId: string): Promise<BrokerCommandResult> {
  try {
    const config = await loadConfig();
    const brokers = config.brokers || [];
    const broker = brokers.find((entry) => entry.id === brokerId);

    if (!broker) {
      return {
        success: false,
        message: `Broker "${brokerId}" not found`,
      };
    }

    const updatedBrokers = brokers.filter((entry) => entry.id !== brokerId);
    const fallbackActive = updatedBrokers[0]?.id;
    const nextActiveId = config.activeBrokerId === brokerId
      ? fallbackActive
      : config.activeBrokerId;

    const normalizedBrokers = updatedBrokers.map((entry, index) => ({
      ...entry,
      isDefault: nextActiveId ? entry.id === nextActiveId : index === 0,
    }));

    const updatedConfig: GordonConfig = {
      ...config,
      brokers: normalizedBrokers,
      activeBrokerId: nextActiveId,
    };
    await saveConfig(updatedConfig);

    const creds = resolveBrokerCredentials(broker);
    BrokerFactory.removeFromCache(broker.type, creds);
    await refreshRuntimeCredentials();

    logger.info("Removed broker", { brokerId, type: broker.type });

    return {
      success: true,
      message: `Removed broker "${broker.id}" (${broker.type})`,
      data: {
        removedBroker: { id: broker.id, type: broker.type },
        newActiveId: nextActiveId || null,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to remove broker: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function brokerStatus(): Promise<BrokerCommandResult> {
  try {
    const config = await loadConfig();
    const brokers = config.brokers || [];

    if (brokers.length === 0) {
      return {
        success: true,
        message: "No brokers configured",
        data: { statuses: [] },
      };
    }

    const statuses: Array<{
      id: string;
      type: BrokerId;
      isActive: boolean;
      connected: boolean;
      paper: boolean;
      marketOpen?: boolean;
      nextOpen?: string;
      nextClose?: string;
      error?: string;
    }> = [];

    for (const brokerConfig of brokers) {
      try {
        const creds = resolveBrokerCredentials(brokerConfig);
        if (!creds.apiKey || !creds.apiSecret) {
          statuses.push({
            id: brokerConfig.id,
            type: brokerConfig.type,
            isActive: brokerConfig.id === config.activeBrokerId,
            connected: false,
            paper: brokerConfig.paper ?? true,
            error: "Missing credentials (set .env or keyring values)",
          });
          continue;
        }

        const broker = BrokerFactory.create(brokerConfig.type, creds);
        const connected = await broker.testConnection();

        if (!connected) {
          statuses.push({
            id: brokerConfig.id,
            type: brokerConfig.type,
            isActive: brokerConfig.id === config.activeBrokerId,
            connected,
            paper: brokerConfig.paper ?? true,
          });
          continue;
        }

        const clock = await broker.getClock();
        statuses.push({
          id: brokerConfig.id,
          type: brokerConfig.type,
          isActive: brokerConfig.id === config.activeBrokerId,
          connected,
          paper: brokerConfig.paper ?? true,
          marketOpen: clock.isOpen,
          nextOpen: clock.nextOpen,
          nextClose: clock.nextClose,
        });
      } catch (error) {
        statuses.push({
          id: brokerConfig.id,
          type: brokerConfig.type,
          isActive: brokerConfig.id === config.activeBrokerId,
          connected: false,
          paper: brokerConfig.paper ?? true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const connectedCount = statuses.filter((status) => status.connected).length;
    return {
      success: true,
      message: `${connectedCount}/${brokers.length} broker(s) connected`,
      data: { statuses },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to check broker status: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function getBrokerSetupInstructions(type: BrokerId): string {
  const instructions: Record<BrokerId, string> = {
    alpaca: `
1. Create an account at alpaca.markets
2. Open the paper trading dashboard and generate API keys
3. Copy the API Key ID and API Secret
4. Keep paper mode enabled while testing
5. Use /setup to store ALPACA_API_KEY, ALPACA_API_SECRET, ALPACA_PAPER`,
    webull: `
1. Create a Webull OpenAPI application at developer.webull.com
2. Copy your App Key and App Secret from the application dashboard
3. Use /setup to store WEBULL_API_KEY, WEBULL_API_SECRET, WEBULL_PAPER
4. If multiple brokerage accounts are enabled, set WEBULL_ACCOUNT_ID
5. Start in paper/UAT mode before switching to live`,
    schwab: `
1. Create a Schwab Developer app and enable trader APIs
2. Generate API credentials and token material
3. Use /setup to store SCHWAB_API_KEY, SCHWAB_API_SECRET, SCHWAB_PAPER
4. Optional: set SCHWAB_ACCOUNT_ID to pin a specific account
5. Start in paper/sandbox mode while validating order flow`,
    tradier: `
1. Create a Tradier brokerage account and generate API credentials
2. Copy API token and secret details from the developer console
3. Use /setup to store TRADIER_API_KEY, TRADIER_API_SECRET, TRADIER_PAPER
4. Optional: set TRADIER_ACCOUNT_ID if you manage multiple accounts
5. Validate in sandbox before switching to production`,
    tradestation: `
1. Create a TradeStation developer app and authorize brokerage access
2. Copy API credentials and token material
3. Use /setup to store TRADESTATION_API_KEY, TRADESTATION_API_SECRET, TRADESTATION_PAPER
4. Optional: set TRADESTATION_ACCOUNT_ID to force account selection
5. Validate in SIM mode before live trading`,
    tastytrade: `
1. Use your tastytrade login/email and password for session auth
2. Keep them available for Gordon as TASTYTRADE_API_KEY and TASTYTRADE_API_SECRET
3. Use /setup to store TASTYTRADE_API_KEY, TASTYTRADE_API_SECRET, TASTYTRADE_PAPER
4. Optional: set TASTYTRADE_ACCOUNT_ID for explicit account routing
5. Validate in sandbox before going live`,
    trading212: `
1. Create Trading 212 Public API credentials
2. Copy the API key and API secret
3. Use /setup to store TRADING212_API_KEY, TRADING212_API_SECRET, TRADING212_PAPER
4. Optional: set TRADING212_ACCOUNT_ID to pin a specific account
5. Validate in demo mode before live routing`,
    etrade: `
1. Create an E*TRADE developer application
2. Generate API credentials and OAuth token material
3. Use /setup to store ETRADE_API_KEY, ETRADE_API_SECRET, ETRADE_PAPER
4. Optional: set ETRADE_ACCOUNT_ID if multiple brokerage accounts exist
5. Validate in sandbox before live routing`,
    ibkr: `
1. Start IBKR Client Portal Gateway locally (default http://127.0.0.1:5000)
2. Authenticate gateway session in IBKR
3. Use /setup to store IBKR_API_KEY, IBKR_API_SECRET, IBKR_PAPER
4. Optional: set IBKR_ACCOUNT_ID to pin account routing
5. Validate paper account order flow before live`,
  };
  return instructions[type];
}

export async function handleBrokerCommand(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? "list";
  const subArgs = parts.slice(1);

  let result: BrokerCommandResult;

  switch (subcommand) {
    case "list":
    case "ls":
    case "":
      result = await brokerList();
      break;

    case "add":
    case "new":
      if (subArgs.length === 0 || !subArgs[0]) {
        result = {
          success: false,
          message: `Usage: /broker add <type>\nSupported types: ${BrokerFactory.getSupportedBrokers().join(", ")}`,
        };
      } else {
        result = await brokerAdd(subArgs[0]);
      }
      break;

    case "switch":
    case "use":
    case "select":
      if (subArgs.length === 0 || !subArgs[0]) {
        result = {
          success: false,
          message: "Usage: /broker switch <id>",
        };
      } else {
        result = await brokerSwitch(subArgs[0]);
      }
      break;

    case "remove":
    case "delete":
    case "rm":
      if (subArgs.length === 0 || !subArgs[0]) {
        result = {
          success: false,
          message: "Usage: /broker remove <id>",
        };
      } else {
        result = await brokerRemove(subArgs[0]);
      }
      break;

    case "status":
    case "check":
      result = await brokerStatus();
      break;

    case "setup":
    case "paper":
    case "sandbox": {
      const brokerType = subArgs[0]?.toLowerCase() as BrokerId | undefined;
      const paperGuides: Partial<Record<BrokerId, string>> = {
        alpaca: `ALPACA PAPER TRADING\n1. Sign up at alpaca.markets (paper account is free)\n2. In the Alpaca dashboard, go to Paper Trading > API Keys > Generate\n3. Copy the Key ID and Secret Key\n4. Gordon config: { type: "alpaca", apiKey: "...", apiSecret: "...", paper: true }\n5. Endpoint: https://paper-api.alpaca.markets`,
        tradier: `TRADIER SANDBOX\n1. Register at developer.tradier.com (sandbox is separate from brokerage)\n2. Create an app and generate a Sandbox Access Token\n3. Gordon config: { type: "tradier", apiKey: "<sandbox-token>", paper: true }\n4. Endpoint: https://sandbox.tradier.com/v1`,
        tastytrade: `TASTYTRADE CERTIFICATION\n1. Log in to tastytrade (certif environment uses same credentials)\n2. Gordon config: { type: "tastytrade", apiKey: "<email>", apiSecret: "<password>", paper: true }\n3. Endpoint: https://api.cert.tastyworks.com\n4. Note: cert environment is periodically reset`,
        tradestation: `TRADESTATION SIMULATION\n1. Sign in to your TradeStation developer account\n2. Use the same API Key + Secret (sim routing is configured server-side)\n3. Gordon config: { type: "tradestation", apiKey: "...", apiSecret: "...", paper: true }\n4. Endpoint: https://sim.api.tradestation.com/v3`,
        trading212: `TRADING 212 PRACTICE\n1. Open the Trading 212 app > Invest > Practice\n2. Go to Profile > Account Settings > API > Create\n3. Gordon config: { type: "trading212", apiKey: "...", paper: true }\n4. Practice account is pre-funded with virtual money`,
        ibkr: `INTERACTIVE BROKERS PAPER\n1. In IBKR TWS/Client Portal, request a paper trading account (Account Management)\n2. Run Client Portal Gateway pointed at your paper account\n3. Gordon config: { type: "ibkr", paper: true } — same API, different accountId\n4. Endpoint: http://127.0.0.1:5000 (local gateway)\n5. Set IBKR_PAPER=true or paper: true in config`,
        schwab: `SCHWAB SANDBOX\n1. Create an app at developer.schwab.com\n2. In app settings, enable "Paper Trading" / sandbox environment\n3. Gordon config: { type: "schwab", apiKey: "...", apiSecret: "...", paper: true }`,
      };
      if (brokerType && paperGuides[brokerType]) {
        result = { success: true, message: paperGuides[brokerType]! };
      } else {
        const supported = Object.keys(paperGuides).join(", ");
        result = {
          success: true,
          message: `Stock Broker Paper Trading Setup\n\nBrokers with paper/sandbox support:\n  alpaca      — Paper API (paper-api.alpaca.markets)\n  tradier     — Sandbox (sandbox.tradier.com)\n  tastytrade  — Cert environment (api.cert.tastyworks.com)\n  tradestation — Simulation (sim.api.tradestation.com)\n  trading212  — Practice account\n  ibkr        — Paper trading account (TWS)\n  schwab      — Developer sandbox\n\nUsage: /broker setup <type>\nExample: /broker setup alpaca`,
        };
      }
      break;
    }

    case "help":
      result = {
        success: true,
        message: `Broker Management Commands:
  /broker list              - List configured brokers
  /broker add <type>        - Add a new broker
  /broker setup <type>      - Show paper/sandbox credential guide
  /broker switch <id>       - Switch active broker
  /broker remove <id>       - Remove a broker
  /broker status            - Check broker connection status

Supported broker types: ${BrokerFactory.getSupportedBrokers().join(", ")}
Paper trading: alpaca, tradier, tastytrade, tradestation, trading212, ibkr, schwab

Aliases: /brokers`,
      };
      break;

    default:
      result = {
        success: false,
        message: `Unknown subcommand: ${subcommand}. Use "/broker help" for available commands.`,
      };
  }

  return formatBrokerResult(result);
}

function formatBrokerResult(result: BrokerCommandResult): string {
  const lines: string[] = [];
  lines.push(result.success ? result.message : `Error: ${result.message}`);

  if (!result.data) {
    return lines.join("\n");
  }

  const data = result.data as Record<string, unknown>;

  if (Array.isArray(data.brokers)) {
    const brokers = data.brokers as Array<{
      id: string;
      type: string;
      isActive: boolean;
      paper: boolean;
    }>;

    if (brokers.length > 0) {
      lines.push("");
      for (const broker of brokers) {
        const active = broker.isActive ? "[ACTIVE]" : "";
        const mode = broker.paper ? "[PAPER]" : "[LIVE]";
        lines.push(`  ${broker.id} (${broker.type}) ${active} ${mode}`.trim());
      }
    }
  }

  if (Array.isArray(data.statuses)) {
    const statuses = data.statuses as Array<{
      id: string;
      isActive: boolean;
      connected: boolean;
      paper: boolean;
      marketOpen?: boolean;
      error?: string;
    }>;

    if (statuses.length > 0) {
      lines.push("");
      for (const status of statuses) {
        const conn = status.connected ? "[OK]" : "[DISCONNECTED]";
        const active = status.isActive ? " (active)" : "";
        const mode = status.paper ? "[PAPER]" : "[LIVE]";
        const market = status.marketOpen === undefined ? "" : status.marketOpen ? " [MARKET OPEN]" : " [MARKET CLOSED]";
        lines.push(`  ${status.id}${active}: ${conn} ${mode}${market}`.trim());
        if (status.error) {
          lines.push(`    Error: ${status.error}`);
        }
      }
    }
  }

  if (data.instructions) {
    lines.push("");
    lines.push("Setup Instructions:");
    lines.push(data.instructions as string);
  }

  return lines.join("\n");
}
