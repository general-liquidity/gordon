/**
 * Gordon Error Codes
 * Trackable numeric error codes for all Gordon errors.
 * Format: G{category}{number} — e.g., G1001
 *
 * Categories:
 *   G1xxx — Configuration
 *   G2xxx — Authentication & Authorization
 *   G3xxx — Trading & Orders
 *   G4xxx — Network & Connectivity
 *   G5xxx — System & Internal
 */

export interface ErrorCodeEntry {
  code: string;
  category: string;
  description: string;
  docs?: string;
}

const ERROR_CODE_REGISTRY: Record<string, ErrorCodeEntry> = {
  // G1xxx — Configuration
  CONFIG_ERROR: { code: "G1001", category: "config", description: "Configuration file error" },
  VALIDATION_ERROR: { code: "G1002", category: "config", description: "Validation failed" },
  INVALID_STATE: { code: "G1003", category: "config", description: "Invalid application state" },
  NOT_FOUND: { code: "G1004", category: "config", description: "Resource not found" },

  // G2xxx — Authentication
  UNAUTHORIZED: { code: "G2001", category: "auth", description: "Unauthorized operation" },
  AUTH_FAILURE: { code: "G2002", category: "auth", description: "Authentication failed" },
  BINANCE_AUTH: { code: "G2010", category: "auth", description: "Binance authentication error" },
  COINBASE_AUTH: { code: "G2011", category: "auth", description: "Coinbase authentication error" },
  KRAKEN_AUTH: { code: "G2012", category: "auth", description: "Kraken authentication error" },
  INVALID_WALLET: { code: "G2013", category: "auth", description: "Invalid wallet address" },
  WALLET_SIGNING: { code: "G2014", category: "auth", description: "Wallet signing failed" },

  // G3xxx — Trading
  INSUFFICIENT_BALANCE: { code: "G3001", category: "trading", description: "Insufficient balance" },
  INSUFFICIENT_FUNDS: { code: "G3002", category: "trading", description: "Insufficient funds" },
  INSUFFICIENT_MARGIN: { code: "G3003", category: "trading", description: "Insufficient margin" },
  INVALID_SYMBOL: { code: "G3004", category: "trading", description: "Invalid trading symbol" },
  INVALID_PLAN: { code: "G3005", category: "trading", description: "Invalid trade plan" },
  TRADING_MODE: { code: "G3006", category: "trading", description: "Trading mode conflict" },
  PLAN_NOT_FOUND: { code: "G3007", category: "trading", description: "Trade plan not found" },
  TRADE_NOT_FOUND: { code: "G3008", category: "trading", description: "Trade not found" },
  TRADE_NOT_MODIFIABLE: { code: "G3009", category: "trading", description: "Trade cannot be modified" },
  RISK_LIMIT: { code: "G3010", category: "trading", description: "Risk limit exceeded" },
  ORDER_TRIGGER: { code: "G3011", category: "trading", description: "Order would trigger immediately" },
  ANALYSIS_ERROR: { code: "G3012", category: "trading", description: "Analysis failed" },

  // G4xxx — Network
  RATE_LIMIT: { code: "G4001", category: "network", description: "Rate limit exceeded" },
  BINANCE_RATE_LIMIT: { code: "G4010", category: "network", description: "Binance rate limit" },
  COINBASE_RATE_LIMIT: { code: "G4011", category: "network", description: "Coinbase rate limit" },
  KRAKEN_RATE_LIMIT: { code: "G4012", category: "network", description: "Kraken rate limit" },
  HYPERLIQUID_RATE_LIMIT: { code: "G4013", category: "network", description: "Hyperliquid rate limit" },
  BITFINEX_RATE_LIMIT: { code: "G4014", category: "network", description: "Bitfinex rate limit" },
  BINANCE_CONNECTION: { code: "G4020", category: "network", description: "Binance connection error" },
  COINBASE_CONNECTION: { code: "G4021", category: "network", description: "Coinbase connection error" },
  KRAKEN_CONNECTION: { code: "G4022", category: "network", description: "Kraken connection error" },
  HYPERLIQUID_CONNECTION: { code: "G4023", category: "network", description: "Hyperliquid connection error" },
  BITFINEX_CONNECTION: { code: "G4024", category: "network", description: "Bitfinex connection error" },

  // G5xxx — System
  UNKNOWN_ERROR: { code: "G5001", category: "system", description: "Unknown error" },
  BINANCE_ERROR: { code: "G5010", category: "system", description: "Binance API error" },
  COINBASE_ERROR: { code: "G5011", category: "system", description: "Coinbase API error" },
  KRAKEN_ERROR: { code: "G5012", category: "system", description: "Kraken API error" },
  HYPERLIQUID_ERROR: { code: "G5013", category: "system", description: "Hyperliquid API error" },
  BITFINEX_ERROR: { code: "G5014", category: "system", description: "Bitfinex API error" },
  NOT_SUPPORTED: { code: "G5020", category: "system", description: "Operation not supported" },
};

/**
 * Get the Gordon error code for a string error code.
 * Returns the G-prefixed code or null if not mapped.
 */
export function getErrorCode(stringCode: string): string | null {
  return ERROR_CODE_REGISTRY[stringCode]?.code ?? null;
}

/**
 * Get full error code entry for a string error code.
 */
export function getErrorCodeEntry(stringCode: string): ErrorCodeEntry | null {
  return ERROR_CODE_REGISTRY[stringCode] ?? null;
}

/**
 * Look up an error code entry by its G-prefixed code (e.g., "G3001").
 */
export function lookupByGCode(gCode: string): ErrorCodeEntry | null {
  for (const entry of Object.values(ERROR_CODE_REGISTRY)) {
    if (entry.code === gCode) return entry;
  }
  return null;
}

/**
 * Format an error code for display.
 */
export function formatErrorCode(stringCode: string): string {
  const entry = ERROR_CODE_REGISTRY[stringCode];
  if (!entry) return stringCode;
  return `${entry.code} (${stringCode})`;
}
