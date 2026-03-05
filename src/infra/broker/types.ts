/**
 * Broker Abstraction Layer - Core Types
 * Defines normalized broker interfaces for stock/options integrations.
 */

// ============================================================================
// Broker Identification
// ============================================================================

/**
 * Supported broker identifiers.
 * Start with Alpaca; expand with IBKR/Tradier/Schwab/E*TRADE later.
 */
export type BrokerId =
  | "alpaca"
  | "webull"
  | "schwab"
  | "tradier"
  | "tradestation"
  | "tastytrade"
  | "etrade"
  | "ibkr";

/**
 * Broker credentials for authentication.
 */
export interface BrokerCredentials {
  apiKey: string;
  apiSecret: string;
  /** Optional account identifier (required by some broker APIs) */
  accountId?: string;
  /** Paper/sandbox trading mode */
  paper?: boolean;
  /** Optional override for trading API host */
  baseUrl?: string;
  /** Optional override for market-data API host */
  dataBaseUrl?: string;
}

/**
 * Maps broker type -> environment variable names for credential storage.
 * Used by config resolution to restore masked credentials from process.env.
 */
export const BROKER_ENV_MAP: Record<BrokerId, { key: string; secret: string; paper?: string; accountId?: string }> = {
  alpaca: { key: "ALPACA_API_KEY", secret: "ALPACA_API_SECRET", paper: "ALPACA_PAPER" },
  webull: { key: "WEBULL_API_KEY", secret: "WEBULL_API_SECRET", paper: "WEBULL_PAPER", accountId: "WEBULL_ACCOUNT_ID" },
  schwab: { key: "SCHWAB_API_KEY", secret: "SCHWAB_API_SECRET", paper: "SCHWAB_PAPER", accountId: "SCHWAB_ACCOUNT_ID" },
  tradier: { key: "TRADIER_API_KEY", secret: "TRADIER_API_SECRET", paper: "TRADIER_PAPER", accountId: "TRADIER_ACCOUNT_ID" },
  tradestation: {
    key: "TRADESTATION_API_KEY",
    secret: "TRADESTATION_API_SECRET",
    paper: "TRADESTATION_PAPER",
    accountId: "TRADESTATION_ACCOUNT_ID",
  },
  tastytrade: {
    key: "TASTYTRADE_API_KEY",
    secret: "TASTYTRADE_API_SECRET",
    paper: "TASTYTRADE_PAPER",
    accountId: "TASTYTRADE_ACCOUNT_ID",
  },
  etrade: {
    key: "ETRADE_API_KEY",
    secret: "ETRADE_API_SECRET",
    paper: "ETRADE_PAPER",
    accountId: "ETRADE_ACCOUNT_ID",
  },
  ibkr: {
    key: "IBKR_API_KEY",
    secret: "IBKR_API_SECRET",
    paper: "IBKR_PAPER",
    accountId: "IBKR_ACCOUNT_ID",
  },
};

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "paper"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "live"].includes(normalized)) return false;
  return undefined;
}

/**
 * Resolve broker credentials, preferring process.env over config values.
 * Config may store "***" placeholders; this resolves them from env.
 */
export function resolveBrokerCredentials(
  config: {
    type: string;
    apiKey: string;
    apiSecret: string;
    paper?: boolean;
    baseUrl?: string;
    dataBaseUrl?: string;
    accountId?: string;
  },
): BrokerCredentials {
  const envMap = config.type in BROKER_ENV_MAP
    ? BROKER_ENV_MAP[config.type as BrokerId]
    : undefined;
  const isRedacted = (v: string | undefined) => !v || v === "***";

  let apiKey = config.apiKey;
  let apiSecret = config.apiSecret;
  let paper = config.paper;
  let accountId = config.accountId;

  if (envMap) {
    if (isRedacted(apiKey)) apiKey = process.env[envMap.key] || "";
    if (isRedacted(apiSecret)) apiSecret = process.env[envMap.secret] || "";
    if (paper === undefined && envMap.paper) {
      paper = parseBooleanEnv(process.env[envMap.paper]);
    }
    if ((!accountId || accountId === "***") && envMap.accountId) {
      accountId = process.env[envMap.accountId];
    }
  }

  if (isRedacted(apiKey)) apiKey = "";
  if (isRedacted(apiSecret)) apiSecret = "";

  return {
    apiKey,
    apiSecret,
    accountId: accountId === "***" ? undefined : accountId,
    paper,
    baseUrl: config.baseUrl,
    dataBaseUrl: config.dataBaseUrl,
  };
}

// ============================================================================
// Normalized Broker Domain Types
// ============================================================================

export interface BrokerCapabilities {
  supportsMarketOrders: boolean;
  supportsLimitOrders: boolean;
  supportsExtendedHours: boolean;
  supportsFractionalShares: boolean;
  supportsShortSelling: boolean;
  supportsOptions: boolean;
  supportsStreaming: boolean;
  supportsPaperTrading: boolean;
}

export type BrokerOrderSide = "buy" | "sell";
export type BrokerOrderType = "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";
export type BrokerTimeInForce = "day" | "gtc" | "opg" | "cls" | "ioc" | "fok";
export type BrokerOrderStatus =
  | "new"
  | "accepted"
  | "partially_filled"
  | "filled"
  | "done_for_day"
  | "canceled"
  | "expired"
  | "replaced"
  | "pending_cancel"
  | "pending_replace"
  | "pending_new"
  | "rejected"
  | "stopped"
  | "suspended"
  | "calculated"
  | "unknown";

export interface BrokerClock {
  timestamp: string;
  isOpen: boolean;
  nextOpen: string;
  nextClose: string;
}

export interface BrokerAccount {
  id: string;
  status: string;
  currency: string;
  cash: number;
  buyingPower: number;
  portfolioValue: number;
  patternDayTrader: boolean;
  shortingEnabled: boolean;
  tradingBlocked: boolean;
}

export interface BrokerPosition {
  symbol: string;
  qty: number;
  side: "long" | "short";
  marketValue: number;
  avgEntryPrice: number;
  unrealizedPl: number;
  unrealizedPlPercent: number;
}

export interface BrokerOrder {
  id: string;
  clientOrderId?: string;
  symbol: string;
  side: BrokerOrderSide;
  type: BrokerOrderType;
  timeInForce: BrokerTimeInForce;
  status: BrokerOrderStatus;
  qty: number;
  filledQty: number;
  notional?: number;
  limitPrice?: number;
  stopPrice?: number;
  extendedHours: boolean;
  submittedAt?: string;
  filledAt?: string;
  canceledAt?: string;
}

export interface BrokerOrderRequest {
  symbol: string;
  side: BrokerOrderSide;
  type: BrokerOrderType;
  timeInForce: BrokerTimeInForce;
  qty?: number;
  notional?: number;
  limitPrice?: number;
  stopPrice?: number;
  trailPercent?: number;
  trailPrice?: number;
  extendedHours?: boolean;
  clientOrderId?: string;
}

export interface BrokerOrderListParams {
  status?: "open" | "closed" | "all";
  limit?: number;
  direction?: "asc" | "desc";
  after?: string;
  until?: string;
  symbols?: string[];
}

export interface BrokerQuote {
  symbol: string;
  bidPrice: number;
  bidSize: number;
  askPrice: number;
  askSize: number;
  timestamp: string;
}

// ============================================================================
// Broker Interface
// ============================================================================

/**
 * Abstract Broker interface.
 * All stock broker adapters must implement this normalized contract.
 */
export interface BrokerAdapter {
  /** Broker identifier */
  readonly brokerId: BrokerId;
  /** Human-readable broker name */
  readonly displayName: string;
  /** Feature/capability flags */
  readonly capabilities: BrokerCapabilities;

  /** Test authenticated connectivity */
  testConnection(): Promise<boolean>;

  /** Market clock (session status, next open/close) */
  getClock(): Promise<BrokerClock>;

  /** Account snapshot */
  getAccount(): Promise<BrokerAccount>;

  /** Open positions */
  getPositions(): Promise<BrokerPosition[]>;

  /** Open orders convenience helper */
  getOpenOrders(limit?: number): Promise<BrokerOrder[]>;

  /** List orders with filters */
  listOrders(params?: BrokerOrderListParams): Promise<BrokerOrder[]>;

  /** Fetch one order by ID */
  getOrder(orderId: string): Promise<BrokerOrder>;

  /** Place an order */
  placeOrder(params: BrokerOrderRequest): Promise<BrokerOrder>;

  /** Cancel one order */
  cancelOrder(orderId: string): Promise<void>;

  /** Cancel all open orders */
  cancelAllOrders(): Promise<void>;

  /** Latest best bid/ask quote for a symbol */
  getLatestQuote(symbol: string): Promise<BrokerQuote>;
}
