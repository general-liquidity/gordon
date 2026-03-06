/**
 * Stocks Commands
 * Tool-level command surface for stock/options brokers.
 *
 * Commands:
 * - /stocks account
 * - /stocks quote <symbol>
 * - /stocks positions
 * - /stocks orders [open|closed|all] [limit]
 * - /stocks buy <symbol> <qty|$notional> [market|limit <price>] [day|gtc|ioc|fok]
 * - /stocks sell <symbol> <qty> [market|limit <price>] [day|gtc|ioc|fok]
 */

import { loadConfig } from "../../infra/storage/config.ts";
import { BrokerFactory } from "../../infra/broker/factory.ts";
import { resolveBrokerCredentials, type BrokerAdapter, type BrokerId, type BrokerTimeInForce } from "../../infra/broker/types.ts";
import { checkEnvStatus } from "../../infra/storage/env.ts";

interface ActiveBrokerResolution {
  broker: BrokerAdapter;
  brokerId: string;
  brokerType: string;
  paper: boolean;
}

interface StocksCommandResult {
  success: boolean;
  message: string;
}

function parsePositiveNumber(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseTimeInForce(value: string | undefined): BrokerTimeInForce | null {
  if (!value) return "day";
  const normalized = value.toLowerCase();
  if (normalized === "day" || normalized === "gtc" || normalized === "opg" || normalized === "cls" || normalized === "ioc" || normalized === "fok") {
    return normalized;
  }
  return null;
}

async function resolveActiveBroker(): Promise<ActiveBrokerResolution> {
  const config = await loadConfig();
  const brokers = config.brokers || [];

  if (brokers.length > 0) {
    const activeId = config.activeBrokerId || brokers.find((entry) => entry.isDefault)?.id;
    const active = brokers.find((entry) => entry.id === activeId) || brokers[0];
    if (!active) {
      throw new Error("No active broker found in configuration");
    }

    const creds = resolveBrokerCredentials(active);
    if (!creds.apiKey || !creds.apiSecret) {
      throw new Error(`Missing credentials for broker "${active.id}". Run /setup to configure broker keys.`);
    }

    return {
      broker: BrokerFactory.create(active.type, creds),
      brokerId: active.id,
      brokerType: active.type,
      paper: active.paper ?? true,
    };
  }

  // Fallback: allow direct env-based broker usage even before config persistence.
  const env = await checkEnvStatus();
  if (env.hasAlpacaKeys && env.keys.ALPACA_API_KEY && env.keys.ALPACA_API_SECRET) {
    const paper = (env.keys.ALPACA_PAPER || "true").toLowerCase() !== "false";
    return {
      broker: BrokerFactory.create("alpaca", {
        apiKey: env.keys.ALPACA_API_KEY,
        apiSecret: env.keys.ALPACA_API_SECRET,
        paper,
      }),
      brokerId: "alpaca_env",
      brokerType: "alpaca",
      paper,
    };
  }

  if (env.hasWebullKeys && env.keys.WEBULL_API_KEY && env.keys.WEBULL_API_SECRET) {
    const paper = (env.keys.WEBULL_PAPER || "true").toLowerCase() !== "false";
    return {
      broker: BrokerFactory.create("webull", {
        apiKey: env.keys.WEBULL_API_KEY,
        apiSecret: env.keys.WEBULL_API_SECRET,
        paper,
        accountId: env.keys.WEBULL_ACCOUNT_ID,
      }),
      brokerId: "webull_env",
      brokerType: "webull",
      paper,
    };
  }

  const fallbackCandidates: Array<{
    brokerId: BrokerId;
    key?: string;
    secret?: string;
    paper?: string;
    accountId?: string;
  }> = [
    {
      brokerId: "schwab",
      key: env.keys.SCHWAB_API_KEY,
      secret: env.keys.SCHWAB_API_SECRET,
      paper: env.keys.SCHWAB_PAPER,
      accountId: env.keys.SCHWAB_ACCOUNT_ID,
    },
    {
      brokerId: "tradier",
      key: env.keys.TRADIER_API_KEY,
      secret: env.keys.TRADIER_API_SECRET,
      paper: env.keys.TRADIER_PAPER,
      accountId: env.keys.TRADIER_ACCOUNT_ID,
    },
    {
      brokerId: "tradestation",
      key: env.keys.TRADESTATION_API_KEY,
      secret: env.keys.TRADESTATION_API_SECRET,
      paper: env.keys.TRADESTATION_PAPER,
      accountId: env.keys.TRADESTATION_ACCOUNT_ID,
    },
    {
      brokerId: "tastytrade",
      key: env.keys.TASTYTRADE_API_KEY,
      secret: env.keys.TASTYTRADE_API_SECRET,
      paper: env.keys.TASTYTRADE_PAPER,
      accountId: env.keys.TASTYTRADE_ACCOUNT_ID,
    },
    {
      brokerId: "trading212",
      key: env.keys.TRADING212_API_KEY,
      secret: env.keys.TRADING212_API_SECRET,
      paper: env.keys.TRADING212_PAPER,
      accountId: env.keys.TRADING212_ACCOUNT_ID,
    },
    {
      brokerId: "etrade",
      key: env.keys.ETRADE_API_KEY,
      secret: env.keys.ETRADE_API_SECRET,
      paper: env.keys.ETRADE_PAPER,
      accountId: env.keys.ETRADE_ACCOUNT_ID,
    },
    {
      brokerId: "ibkr",
      key: env.keys.IBKR_API_KEY,
      secret: env.keys.IBKR_API_SECRET,
      paper: env.keys.IBKR_PAPER,
      accountId: env.keys.IBKR_ACCOUNT_ID,
    },
  ];

  for (const candidate of fallbackCandidates) {
    if (!candidate.key || !candidate.secret) continue;
    const paper = (candidate.paper || "true").toLowerCase() !== "false";
    return {
      broker: BrokerFactory.create(candidate.brokerId, {
        apiKey: candidate.key,
        apiSecret: candidate.secret,
        paper,
        accountId: candidate.accountId,
      }),
      brokerId: `${candidate.brokerId}_env`,
      brokerType: candidate.brokerId,
      paper,
    };
  }

  throw new Error("No broker configured. Use /setup or /broker add first.");
}

function parseOrderArgs(args: string[]): {
  symbol: string;
  qty?: number;
  notional?: number;
  type: "market" | "limit";
  limitPrice?: number;
  timeInForce: BrokerTimeInForce;
} | { error: string } {
  if (args.length < 2 || !args[0] || !args[1]) {
    return { error: "Usage: /stocks buy|sell <symbol> <qty|$notional> [market|limit <price>] [day|gtc|ioc|fok]" };
  }

  const symbol = args[0].toUpperCase();
  const sizeToken = args[1];

  let qty: number | undefined;
  let notional: number | undefined;

  if (sizeToken.startsWith("$")) {
    const parsedNotional = parsePositiveNumber(sizeToken.slice(1));
    if (!parsedNotional) {
      return { error: `Invalid notional amount: ${sizeToken}` };
    }
    notional = parsedNotional;
  } else {
    const parsedQty = parsePositiveNumber(sizeToken);
    if (!parsedQty) {
      return { error: `Invalid quantity: ${sizeToken}` };
    }
    qty = parsedQty;
  }

  let type: "market" | "limit" = "market";
  let limitPrice: number | undefined;
  let timeInForce: BrokerTimeInForce = "day";

  let index = 2;
  const maybeType = args[index]?.toLowerCase();
  if (maybeType === "market") {
    type = "market";
    index += 1;
  } else if (maybeType === "limit") {
    type = "limit";
    index += 1;
    const priceToken = args[index];
    const parsedPrice = parsePositiveNumber(priceToken || "");
    if (!parsedPrice) {
      return { error: "Limit orders require a valid price: /stocks buy <symbol> <qty> limit <price>" };
    }
    limitPrice = parsedPrice;
    index += 1;
  }

  const tif = parseTimeInForce(args[index]);
  if (tif === null) {
    return { error: `Invalid time-in-force: ${args[index]}. Use day|gtc|ioc|fok|opg|cls` };
  }
  timeInForce = tif;

  return {
    symbol,
    qty,
    notional,
    type,
    limitPrice,
    timeInForce,
  };
}

function formatStocksResult(result: StocksCommandResult): string {
  return result.success ? result.message : `Error: ${result.message}`;
}

async function stocksAccount(): Promise<StocksCommandResult> {
  try {
    const { broker, brokerId, brokerType, paper } = await resolveActiveBroker();
    const [account, clock] = await Promise.all([broker.getAccount(), broker.getClock()]);

    const marketStatus = clock.isOpen ? "OPEN" : "CLOSED";
    const mode = paper ? "PAPER" : "LIVE";
    return {
      success: true,
      message:
        `Broker account (${brokerId} / ${brokerType}, ${mode})\n` +
        `  Status: ${account.status} | Market: ${marketStatus}\n` +
        `  Cash: $${account.cash.toLocaleString(undefined, { maximumFractionDigits: 2 })}\n` +
        `  Buying Power: $${account.buyingPower.toLocaleString(undefined, { maximumFractionDigits: 2 })}\n` +
        `  Portfolio Value: $${account.portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to fetch broker account: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function stocksQuote(symbol: string): Promise<StocksCommandResult> {
  try {
    if (!symbol) {
      return { success: false, message: "Usage: /stocks quote <symbol>" };
    }

    const { broker, brokerId, paper } = await resolveActiveBroker();
    const quote = await broker.getLatestQuote(symbol.toUpperCase());
    const mid = (quote.bidPrice + quote.askPrice) / 2;

    return {
      success: true,
      message:
        `${quote.symbol} quote (${brokerId}, ${paper ? "PAPER" : "LIVE"})\n` +
        `  Bid: $${quote.bidPrice.toFixed(4)} (${quote.bidSize})\n` +
        `  Ask: $${quote.askPrice.toFixed(4)} (${quote.askSize})\n` +
        `  Mid: $${mid.toFixed(4)}\n` +
        `  Time: ${quote.timestamp}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to fetch quote: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function stocksPositions(): Promise<StocksCommandResult> {
  try {
    const { broker, brokerId, paper } = await resolveActiveBroker();
    const positions = await broker.getPositions();

    if (positions.length === 0) {
      return {
        success: true,
        message: `No stock positions open (${brokerId}, ${paper ? "PAPER" : "LIVE"}).`,
      };
    }

    const lines = [
      `Open stock positions (${brokerId}, ${paper ? "PAPER" : "LIVE"}):`,
      ...positions.map((position) =>
        `  ${position.symbol}: ${position.qty} ${position.side} | MV $${position.marketValue.toFixed(2)} | PnL $${position.unrealizedPl.toFixed(2)} (${(position.unrealizedPlPercent * 100).toFixed(2)}%)`
      ),
    ];

    return { success: true, message: lines.join("\n") };
  } catch (error) {
    return {
      success: false,
      message: `Failed to fetch positions: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function stocksOrders(statusArg: string | undefined, limitArg: string | undefined): Promise<StocksCommandResult> {
  try {
    const { broker, brokerId, paper } = await resolveActiveBroker();
    const status = (statusArg || "open").toLowerCase();
    const limit = limitArg ? Number(limitArg) : 20;

    if (!Number.isFinite(limit) || limit <= 0) {
      return { success: false, message: `Invalid limit: ${limitArg}` };
    }

    const orders = status === "open"
      ? await broker.getOpenOrders(limit)
      : await broker.listOrders({
          status: status === "all" || status === "closed" ? status : "open",
          limit,
        });

    if (orders.length === 0) {
      return {
        success: true,
        message: `No ${status} stock orders (${brokerId}, ${paper ? "PAPER" : "LIVE"}).`,
      };
    }

    const lines = [
      `${status.toUpperCase()} stock orders (${brokerId}, ${paper ? "PAPER" : "LIVE"}):`,
      ...orders.map((order) =>
        `  ${order.symbol}: ${order.side.toUpperCase()} ${order.qty || order.notional || 0} ${order.type.toUpperCase()} ${order.status}`
      ),
    ];
    return { success: true, message: lines.join("\n") };
  } catch (error) {
    return {
      success: false,
      message: `Failed to fetch orders: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function stocksPlace(side: "buy" | "sell", args: string[]): Promise<StocksCommandResult> {
  try {
    const config = await loadConfig();
    if (config.mode !== "ARMED") {
      return {
        success: false,
        message: "System is SAFE. Use /arm before placing live broker orders.",
      };
    }

    const parsed = parseOrderArgs(args);
    if ("error" in parsed) {
      return { success: false, message: parsed.error };
    }

    const { broker, brokerId, paper } = await resolveActiveBroker();
    const order = await broker.placeOrder({
      symbol: parsed.symbol,
      side,
      type: parsed.type,
      timeInForce: parsed.timeInForce,
      qty: parsed.qty,
      notional: parsed.notional,
      limitPrice: parsed.limitPrice,
      extendedHours: false,
    });

    return {
      success: true,
      message:
        `Order placed (${brokerId}, ${paper ? "PAPER" : "LIVE"}):\n` +
        `  ${order.side.toUpperCase()} ${order.symbol}\n` +
        `  Type: ${order.type.toUpperCase()} | TIF: ${order.timeInForce.toUpperCase()}\n` +
        `  Qty: ${order.qty} | Filled: ${order.filledQty}\n` +
        `  Status: ${order.status} | Order ID: ${order.id}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to place ${side} order: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function handleStocksCommand(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const subcommand = (parts[0] || "help").toLowerCase();
  const subArgs = parts.slice(1);

  let result: StocksCommandResult;

  switch (subcommand) {
    case "account":
    case "portfolio":
    case "summary":
      result = await stocksAccount();
      break;
    case "quote":
      result = await stocksQuote(subArgs[0] || "");
      break;
    case "positions":
      result = await stocksPositions();
      break;
    case "orders":
      result = await stocksOrders(subArgs[0], subArgs[1]);
      break;
    case "buy":
      result = await stocksPlace("buy", subArgs);
      break;
    case "sell":
      result = await stocksPlace("sell", subArgs);
      break;
    case "help":
      result = {
        success: true,
        message:
          `Stocks Commands:\n` +
          `  /stocks account\n` +
          `  /stocks quote <symbol>\n` +
          `  /stocks positions\n` +
          `  /stocks orders [open|closed|all] [limit]\n` +
          `  /stocks buy <symbol> <qty|$notional> [market|limit <price>] [day|gtc|ioc|fok]\n` +
          `  /stocks sell <symbol> <qty> [market|limit <price>] [day|gtc|ioc|fok]\n\n` +
          `Examples:\n` +
          `  /stocks quote AAPL\n` +
          `  /stocks buy AAPL 5\n` +
          `  /stocks buy NVDA $500 limit 870 gtc\n` +
          `  /stocks orders open 20`,
      };
      break;
    default:
      result = {
        success: false,
        message: `Unknown stocks subcommand: ${subcommand}. Use "/stocks help".`,
      };
      break;
  }

  return formatStocksResult(result);
}
