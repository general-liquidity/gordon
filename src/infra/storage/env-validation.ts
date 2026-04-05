/**
 * Environment Variable Validation
 *
 * Validates API keys and configuration values with:
 * - Format validation (prefixes, length, characters)
 * - Non-empty checks
 * - Credential pair validation
 */

import { z } from "zod";

// API Key format patterns
const OPENAI_KEY_PATTERN = /^sk-[a-zA-Z0-9-_]{32,}$/;
const DEDALUS_KEY_PATTERN = /^dd-[a-zA-Z0-9-_]{16,}$/;
const BINANCE_KEY_PATTERN = /^[a-zA-Z0-9]{64}$/;
const BINANCE_SECRET_PATTERN = /^[a-zA-Z0-9]{64}$/;
const COINBASE_KEY_PATTERN = /^[a-zA-Z0-9]{16,64}$/;
const COINBASE_SECRET_PATTERN = /^[a-zA-Z0-9+/=]{16,}$/;
const COINBASE_PASSPHRASE_PATTERN = /^[a-zA-Z0-9]{4,}$/;
const KRAKEN_KEY_PATTERN = /^[a-zA-Z0-9+/=]{10,}$/;
const KRAKEN_SECRET_PATTERN = /^[a-zA-Z0-9+/=]{10,}$/;
const HYPERLIQUID_KEY_PATTERN = /^(0x)?[a-fA-F0-9]{64}$/;
const BITFINEX_KEY_PATTERN = /^[a-zA-Z0-9_-]{10,}$/;
const BITFINEX_SECRET_PATTERN = /^[a-zA-Z0-9_-]{10,}$/;
const ALPACA_KEY_PATTERN = /^(PK|AK|CK)[a-zA-Z0-9]{14,30}$/;
const BEARER_TOKEN_PATTERN = /^[a-zA-Z0-9._\-+/=]{8,}$/;

// Validation schemas
export const OpenAIKeySchema = z
  .string()
  .trim()
  .min(1, "OpenAI API key cannot be empty")
  .refine(
    (val) => OPENAI_KEY_PATTERN.test(val),
    "OpenAI API key must start with 'sk-' followed by at least 32 characters"
  );

export const DedalusKeySchema = z
  .string()
  .trim()
  .min(1, "Dedalus API key cannot be empty")
  .refine(
    (val) => DEDALUS_KEY_PATTERN.test(val),
    "Dedalus API key must start with 'dd-' followed by at least 16 characters"
  );

export const BinanceKeySchema = z
  .string()
  .trim()
  .min(1, "Binance API key cannot be empty")
  .refine(
    (val) => BINANCE_KEY_PATTERN.test(val),
    "Binance API key must be exactly 64 alphanumeric characters"
  );

export const BinanceSecretSchema = z
  .string()
  .trim()
  .min(1, "Binance API secret cannot be empty")
  .refine(
    (val) => BINANCE_SECRET_PATTERN.test(val),
    "Binance API secret must be exactly 64 alphanumeric characters"
  );

export const CoinbaseKeySchema = z
  .string()
  .trim()
  .min(1, "Coinbase API key cannot be empty")
  .refine(
    (val) => COINBASE_KEY_PATTERN.test(val),
    "Coinbase API key must be 16-64 alphanumeric characters"
  );

export const CoinbaseSecretSchema = z
  .string()
  .trim()
  .min(1, "Coinbase API secret cannot be empty")
  .refine(
    (val) => COINBASE_SECRET_PATTERN.test(val),
    "Coinbase API secret must be at least 16 base64-compatible characters"
  );

export const CoinbasePassphraseSchema = z
  .string()
  .trim()
  .min(1, "Coinbase passphrase cannot be empty")
  .refine(
    (val) => COINBASE_PASSPHRASE_PATTERN.test(val),
    "Coinbase passphrase must be at least 4 alphanumeric characters"
  );

export const KrakenKeySchema = z
  .string()
  .trim()
  .min(1, "Kraken API key cannot be empty")
  .refine(
    (val) => KRAKEN_KEY_PATTERN.test(val),
    "Kraken API key must be at least 10 base64-compatible characters"
  );

export const KrakenSecretSchema = z
  .string()
  .trim()
  .min(1, "Kraken API secret cannot be empty")
  .refine(
    (val) => KRAKEN_SECRET_PATTERN.test(val),
    "Kraken API secret must be at least 10 base64-compatible characters"
  );

export const HyperliquidKeySchema = z
  .string()
  .trim()
  .min(1, "Hyperliquid private key cannot be empty")
  .refine(
    (val) => HYPERLIQUID_KEY_PATTERN.test(val),
    "Hyperliquid private key must be 64 hex characters (with optional 0x prefix)"
  );

export const BitfinexKeySchema = z
  .string()
  .trim()
  .min(1, "Bitfinex API key cannot be empty")
  .refine(
    (val) => BITFINEX_KEY_PATTERN.test(val),
    "Bitfinex API key must be at least 10 alphanumeric/dash/underscore characters"
  );

export const BitfinexSecretSchema = z
  .string()
  .trim()
  .min(1, "Bitfinex API secret cannot be empty")
  .refine(
    (val) => BITFINEX_SECRET_PATTERN.test(val),
    "Bitfinex API secret must be at least 10 alphanumeric/dash/underscore characters"
  );

export const InceptionKeySchema = z
  .string()
  .trim()
  .min(1, "Inception API key cannot be empty");

export const HeliusKeySchema = z
  .string()
  .trim()
  .min(1, "Helius API key cannot be empty");

export const MoonPayKeySchema = z
  .string()
  .trim()
  .min(1, "MoonPay API key cannot be empty");

export const MoonPaySecretSchema = z
  .string()
  .trim()
  .min(1, "MoonPay secret key cannot be empty");

export const MoonPayWebhookApiKeySchema = z
  .string()
  .trim()
  .min(1, "MoonPay webhook API key cannot be empty");

export const MoonPayVirtualAccountsPrivateKeySchema = z
  .string()
  .trim()
  .min(1, "MoonPay virtual accounts private key cannot be empty");

export const PolygonX402PrivateKeySchema = z
  .string()
  .trim()
  .min(1, "Polygon x402 private key cannot be empty");

export const AlpacaKeySchema = z
  .string()
  .trim()
  .min(1, "Alpaca API key cannot be empty")
  .refine(
    (val) => ALPACA_KEY_PATTERN.test(val),
    "Alpaca API key must start with 'PK', 'AK', or 'CK' followed by 14-30 alphanumeric characters"
  );

export const AlpacaSecretSchema = z
  .string()
  .trim()
  .min(1, "Alpaca API secret cannot be empty")
  .min(16, "Alpaca API secret must be at least 16 characters");

export const SchwabKeySchema = z
  .string()
  .trim()
  .min(1, "Schwab API key cannot be empty")
  .refine(
    (val) => BEARER_TOKEN_PATTERN.test(val),
    "Schwab API key/token contains invalid characters"
  );

export const SchwabSecretSchema = z
  .string()
  .trim()
  .min(1, "Schwab API secret cannot be empty")
  .refine(
    (val) => BEARER_TOKEN_PATTERN.test(val),
    "Schwab API secret/token contains invalid characters"
  );

export const TradierKeySchema = z
  .string()
  .trim()
  .min(1, "Tradier API key cannot be empty")
  .refine(
    (val) => BEARER_TOKEN_PATTERN.test(val),
    "Tradier API key/token contains invalid characters"
  );

export const TradierSecretSchema = z
  .string()
  .trim()
  .min(1, "Tradier API secret cannot be empty")
  .refine(
    (val) => BEARER_TOKEN_PATTERN.test(val),
    "Tradier API secret/token contains invalid characters"
  );

export const TradeStationKeySchema = z
  .string()
  .trim()
  .min(1, "TradeStation API key cannot be empty")
  .refine(
    (val) => BEARER_TOKEN_PATTERN.test(val),
    "TradeStation API key/token contains invalid characters"
  );

export const TradeStationSecretSchema = z
  .string()
  .trim()
  .min(1, "TradeStation API secret cannot be empty")
  .refine(
    (val) => BEARER_TOKEN_PATTERN.test(val),
    "TradeStation API secret/token contains invalid characters"
  );

export const TastytradeKeySchema = z
  .string()
  .trim()
  .min(1, "tastytrade login/email cannot be empty");

export const TastytradeSecretSchema = z
  .string()
  .trim()
  .min(1, "tastytrade password cannot be empty");

export const Trading212KeySchema = z
  .string()
  .trim()
  .min(1, "Trading 212 API key cannot be empty")
  .min(8, "Trading 212 API key appears too short");

export const Trading212SecretSchema = z
  .string()
  .trim()
  .min(1, "Trading 212 API secret cannot be empty")
  .min(8, "Trading 212 API secret appears too short");

export const EtradeKeySchema = z
  .string()
  .trim()
  .min(1, "E*TRADE API key cannot be empty");

export const EtradeSecretSchema = z
  .string()
  .trim()
  .min(1, "E*TRADE API secret cannot be empty");

export const IbkrKeySchema = z
  .string()
  .trim()
  .min(1, "IBKR gateway host/port cannot be empty");

export const IbkrSecretSchema = z
  .string()
  .trim()
  .min(1, "IBKR session token cannot be empty");

export const RobinhoodKeySchema = z
  .string()
  .trim()
  .min(1, "Robinhood API key cannot be empty");

export const RobinhoodSecretSchema = z
  .string()
  .trim()
  .min(1, "Robinhood API secret/private key cannot be empty");

export const WebullKeySchema = z
  .string()
  .trim()
  .min(1, "Webull API key cannot be empty")
  .min(8, "Webull API key appears too short");

export const WebullSecretSchema = z
  .string()
  .trim()
  .min(1, "Webull API secret cannot be empty")
  .min(8, "Webull API secret appears too short");

// Combined environment schema
export const EnvKeysSchema = z.object({
  OPENAI_API_KEY: OpenAIKeySchema.optional(),
  DEDALUS_API_KEY: DedalusKeySchema.optional(),
  INCEPTION_API_KEY: InceptionKeySchema.optional(),
  ALPACA_API_KEY: AlpacaKeySchema.optional(),
  ALPACA_API_SECRET: AlpacaSecretSchema.optional(),
  SCHWAB_API_KEY: SchwabKeySchema.optional(),
  SCHWAB_API_SECRET: SchwabSecretSchema.optional(),
  TRADIER_API_KEY: TradierKeySchema.optional(),
  TRADIER_API_SECRET: TradierSecretSchema.optional(),
  TRADESTATION_API_KEY: TradeStationKeySchema.optional(),
  TRADESTATION_API_SECRET: TradeStationSecretSchema.optional(),
  TASTYTRADE_API_KEY: TastytradeKeySchema.optional(),
  TASTYTRADE_API_SECRET: TastytradeSecretSchema.optional(),
  TRADING212_API_KEY: Trading212KeySchema.optional(),
  TRADING212_API_SECRET: Trading212SecretSchema.optional(),
  ETRADE_API_KEY: EtradeKeySchema.optional(),
  ETRADE_API_SECRET: EtradeSecretSchema.optional(),
  IBKR_API_KEY: IbkrKeySchema.optional(),
  IBKR_API_SECRET: IbkrSecretSchema.optional(),
  ROBINHOOD_API_KEY: RobinhoodKeySchema.optional(),
  ROBINHOOD_API_SECRET: RobinhoodSecretSchema.optional(),
  WEBULL_API_KEY: WebullKeySchema.optional(),
  WEBULL_API_SECRET: WebullSecretSchema.optional(),
  BINANCE_API_KEY: BinanceKeySchema.optional(),
  BINANCE_API_SECRET: BinanceSecretSchema.optional(),
  COINBASE_API_KEY: CoinbaseKeySchema.optional(),
  COINBASE_API_SECRET: CoinbaseSecretSchema.optional(),
  COINBASE_PASSPHRASE: CoinbasePassphraseSchema.optional(),
  KRAKEN_API_KEY: KrakenKeySchema.optional(),
  KRAKEN_API_SECRET: KrakenSecretSchema.optional(),
  BITFINEX_API_KEY: BitfinexKeySchema.optional(),
  BITFINEX_API_SECRET: BitfinexSecretSchema.optional(),
  HYPERLIQUID_PRIVATE_KEY: HyperliquidKeySchema.optional(),
  HELIUS_API_KEY: HeliusKeySchema.optional(),
  MOONPAY_API_KEY: MoonPayKeySchema.optional(),
  MOONPAY_SECRET_KEY: MoonPaySecretSchema.optional(),
  MOONPAY_WEBHOOK_API_KEY: MoonPayWebhookApiKeySchema.optional(),
  MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY: MoonPayVirtualAccountsPrivateKeySchema.optional(),
  POLYGON_X402_PRIVATE_KEY: PolygonX402PrivateKeySchema.optional(),
});

export type ValidatedEnvKeys = z.infer<typeof EnvKeysSchema>;

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  keys: ValidatedEnvKeys;
}

export interface ValidationError {
  key: string;
  message: string;
}

export interface ValidationWarning {
  key: string;
  message: string;
}

/**
 * Validate a single API key
 */
export function validateApiKey(
  key: string,
  value: string | undefined,
  schema: z.ZodType<string>
): { valid: boolean; error?: string } {
  if (!value) {
    return { valid: true }; // Optional keys are valid when missing
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, error: `${key} is empty or whitespace-only` };
  }

  const result = schema.safeParse(trimmed);
  if (!result.success) {
    return { valid: false, error: result.error.issues[0]?.message || "Invalid format" };
  }

  return { valid: true };
}

/**
 * Validate a single API key with warning-only mode (logs warning instead of error on format mismatch)
 */
export function validateApiKeyWarn(
  key: string,
  value: string | undefined,
  schema: z.ZodType<string>,
  warnings: ValidationWarning[],
  validated: Record<string, string | undefined>,
): boolean {
  if (!value) return true;

  const trimmed = value.trim();
  if (!trimmed) {
    warnings.push({ key, message: `${key} is empty or whitespace-only` });
    return false;
  }

  const result = schema.safeParse(trimmed);
  if (!result.success) {
    // Log as warning, not error — key format may be unusual but still valid
    warnings.push({
      key,
      message: `${key} format looks unexpected: ${result.error.issues[0]?.message || "Invalid format"}. The key will still be used.`,
    });
  }

  validated[key] = trimmed;
  return true;
}

/**
 * Validate all environment keys
 */
export function validateEnvKeys(keys: Record<string, string | undefined>): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const validated: Record<string, string | undefined> = {};

  // Validate OpenAI key
  if (keys.OPENAI_API_KEY) {
    const result = validateApiKey("OPENAI_API_KEY", keys.OPENAI_API_KEY, OpenAIKeySchema);
    if (!result.valid) {
      errors.push({ key: "OPENAI_API_KEY", message: result.error! });
    } else {
      validated.OPENAI_API_KEY = keys.OPENAI_API_KEY.trim();
    }
  }

  // Validate Dedalus key
  if (keys.DEDALUS_API_KEY) {
    const result = validateApiKey("DEDALUS_API_KEY", keys.DEDALUS_API_KEY, DedalusKeySchema);
    if (!result.valid) {
      errors.push({ key: "DEDALUS_API_KEY", message: result.error! });
    } else {
      validated.DEDALUS_API_KEY = keys.DEDALUS_API_KEY.trim();
    }
  }

  if (keys.INCEPTION_API_KEY) {
    const result = validateApiKey("INCEPTION_API_KEY", keys.INCEPTION_API_KEY, InceptionKeySchema);
    if (!result.valid) {
      errors.push({ key: "INCEPTION_API_KEY", message: result.error! });
    } else {
      validated.INCEPTION_API_KEY = keys.INCEPTION_API_KEY.trim();
    }
  }

  if (keys.HELIUS_API_KEY) {
    const result = validateApiKey("HELIUS_API_KEY", keys.HELIUS_API_KEY, HeliusKeySchema);
    if (!result.valid) {
      errors.push({ key: "HELIUS_API_KEY", message: result.error! });
    } else {
      validated.HELIUS_API_KEY = keys.HELIUS_API_KEY.trim();
    }
  }

  // Validate Alpaca keys (must be paired) — format-validated with warnings
  const hasAlpacaKey = !!keys.ALPACA_API_KEY;
  const hasAlpacaSecret = !!keys.ALPACA_API_SECRET;
  if (hasAlpacaKey !== hasAlpacaSecret) {
    errors.push({
      key: hasAlpacaKey ? "ALPACA_API_SECRET" : "ALPACA_API_KEY",
      message: "Alpaca API key and secret must both be provided",
    });
  } else if (hasAlpacaKey && hasAlpacaSecret) {
    validateApiKeyWarn("ALPACA_API_KEY", keys.ALPACA_API_KEY, AlpacaKeySchema, warnings, validated);
    validateApiKeyWarn("ALPACA_API_SECRET", keys.ALPACA_API_SECRET, AlpacaSecretSchema, warnings, validated);
  }

  // Validate Schwab keys (must be paired) — bearer token format
  const hasSchwabKey = !!keys.SCHWAB_API_KEY;
  const hasSchwabSecret = !!keys.SCHWAB_API_SECRET;
  if (hasSchwabKey !== hasSchwabSecret) {
    errors.push({
      key: hasSchwabKey ? "SCHWAB_API_SECRET" : "SCHWAB_API_KEY",
      message: "Schwab API key and secret must both be provided",
    });
  } else if (hasSchwabKey && hasSchwabSecret) {
    validateApiKeyWarn("SCHWAB_API_KEY", keys.SCHWAB_API_KEY, SchwabKeySchema, warnings, validated);
    validateApiKeyWarn("SCHWAB_API_SECRET", keys.SCHWAB_API_SECRET, SchwabSecretSchema, warnings, validated);
  }

  // Validate Tradier keys (must be paired) — bearer token format
  const hasTradierKey = !!keys.TRADIER_API_KEY;
  const hasTradierSecret = !!keys.TRADIER_API_SECRET;
  if (hasTradierKey !== hasTradierSecret) {
    errors.push({
      key: hasTradierKey ? "TRADIER_API_SECRET" : "TRADIER_API_KEY",
      message: "Tradier API key and secret must both be provided",
    });
  } else if (hasTradierKey && hasTradierSecret) {
    validateApiKeyWarn("TRADIER_API_KEY", keys.TRADIER_API_KEY, TradierKeySchema, warnings, validated);
    validateApiKeyWarn("TRADIER_API_SECRET", keys.TRADIER_API_SECRET, TradierSecretSchema, warnings, validated);
  }

  // Validate TradeStation keys (must be paired) — bearer token format
  const hasTradeStationKey = !!keys.TRADESTATION_API_KEY;
  const hasTradeStationSecret = !!keys.TRADESTATION_API_SECRET;
  if (hasTradeStationKey !== hasTradeStationSecret) {
    errors.push({
      key: hasTradeStationKey ? "TRADESTATION_API_SECRET" : "TRADESTATION_API_KEY",
      message: "TradeStation API key and secret must both be provided",
    });
  } else if (hasTradeStationKey && hasTradeStationSecret) {
    validateApiKeyWarn("TRADESTATION_API_KEY", keys.TRADESTATION_API_KEY, TradeStationKeySchema, warnings, validated);
    validateApiKeyWarn("TRADESTATION_API_SECRET", keys.TRADESTATION_API_SECRET, TradeStationSecretSchema, warnings, validated);
  }

  // Validate tastytrade keys (must be paired)
  const hasTastytradeKey = !!keys.TASTYTRADE_API_KEY;
  const hasTastytradeSecret = !!keys.TASTYTRADE_API_SECRET;
  if (hasTastytradeKey !== hasTastytradeSecret) {
    errors.push({
      key: hasTastytradeKey ? "TASTYTRADE_API_SECRET" : "TASTYTRADE_API_KEY",
      message: "tastytrade login/email and password must both be provided",
    });
  } else if (hasTastytradeKey && hasTastytradeSecret) {
    const keyResult = validateApiKey("TASTYTRADE_API_KEY", keys.TASTYTRADE_API_KEY, TastytradeKeySchema);
    if (!keyResult.valid) {
      errors.push({ key: "TASTYTRADE_API_KEY", message: keyResult.error! });
    } else {
      validated.TASTYTRADE_API_KEY = keys.TASTYTRADE_API_KEY!.trim();
    }

    const secretResult = validateApiKey("TASTYTRADE_API_SECRET", keys.TASTYTRADE_API_SECRET, TastytradeSecretSchema);
    if (!secretResult.valid) {
      errors.push({ key: "TASTYTRADE_API_SECRET", message: secretResult.error! });
    } else {
      validated.TASTYTRADE_API_SECRET = keys.TASTYTRADE_API_SECRET!.trim();
    }
  }

  // Validate Trading 212 keys (must be paired) — non-empty with min length
  const hasTrading212Key = !!keys.TRADING212_API_KEY;
  const hasTrading212Secret = !!keys.TRADING212_API_SECRET;
  if (hasTrading212Key !== hasTrading212Secret) {
    errors.push({
      key: hasTrading212Key ? "TRADING212_API_SECRET" : "TRADING212_API_KEY",
      message: "Trading 212 API key and secret must both be provided",
    });
  } else if (hasTrading212Key && hasTrading212Secret) {
    validateApiKeyWarn("TRADING212_API_KEY", keys.TRADING212_API_KEY, Trading212KeySchema, warnings, validated);
    validateApiKeyWarn("TRADING212_API_SECRET", keys.TRADING212_API_SECRET, Trading212SecretSchema, warnings, validated);
  }

  // Validate E*TRADE keys (must be paired)
  const hasEtradeKey = !!keys.ETRADE_API_KEY;
  const hasEtradeSecret = !!keys.ETRADE_API_SECRET;
  if (hasEtradeKey !== hasEtradeSecret) {
    errors.push({
      key: hasEtradeKey ? "ETRADE_API_SECRET" : "ETRADE_API_KEY",
      message: "E*TRADE API key and secret must both be provided",
    });
  } else if (hasEtradeKey && hasEtradeSecret) {
    const keyResult = validateApiKey("ETRADE_API_KEY", keys.ETRADE_API_KEY, EtradeKeySchema);
    if (!keyResult.valid) {
      errors.push({ key: "ETRADE_API_KEY", message: keyResult.error! });
    } else {
      validated.ETRADE_API_KEY = keys.ETRADE_API_KEY!.trim();
    }

    const secretResult = validateApiKey("ETRADE_API_SECRET", keys.ETRADE_API_SECRET, EtradeSecretSchema);
    if (!secretResult.valid) {
      errors.push({ key: "ETRADE_API_SECRET", message: secretResult.error! });
    } else {
      validated.ETRADE_API_SECRET = keys.ETRADE_API_SECRET!.trim();
    }
  }

  // Validate IBKR keys (paired, but no strict format — uses localhost gateway)
  const hasIbkrKey = !!keys.IBKR_API_KEY;
  const hasIbkrSecret = !!keys.IBKR_API_SECRET;
  if (hasIbkrKey !== hasIbkrSecret) {
    errors.push({
      key: hasIbkrKey ? "IBKR_API_SECRET" : "IBKR_API_KEY",
      message: "IBKR API key and secret must both be provided",
    });
  } else if (hasIbkrKey && hasIbkrSecret) {
    const keyResult = validateApiKey("IBKR_API_KEY", keys.IBKR_API_KEY, IbkrKeySchema);
    if (!keyResult.valid) {
      errors.push({ key: "IBKR_API_KEY", message: keyResult.error! });
    } else {
      validated.IBKR_API_KEY = keys.IBKR_API_KEY!.trim();
    }

    const secretResult = validateApiKey("IBKR_API_SECRET", keys.IBKR_API_SECRET, IbkrSecretSchema);
    if (!secretResult.valid) {
      errors.push({ key: "IBKR_API_SECRET", message: secretResult.error! });
    } else {
      validated.IBKR_API_SECRET = keys.IBKR_API_SECRET!.trim();
    }
  }

  // Validate Robinhood keys (must be paired)
  const hasRobinhoodKey = !!keys.ROBINHOOD_API_KEY;
  const hasRobinhoodSecret = !!keys.ROBINHOOD_API_SECRET;
  if (hasRobinhoodKey !== hasRobinhoodSecret) {
    errors.push({
      key: hasRobinhoodKey ? "ROBINHOOD_API_SECRET" : "ROBINHOOD_API_KEY",
      message: "Robinhood API key and secret must both be provided",
    });
  } else if (hasRobinhoodKey && hasRobinhoodSecret) {
    const keyResult = validateApiKey("ROBINHOOD_API_KEY", keys.ROBINHOOD_API_KEY, RobinhoodKeySchema);
    if (!keyResult.valid) {
      errors.push({ key: "ROBINHOOD_API_KEY", message: keyResult.error! });
    } else {
      validated.ROBINHOOD_API_KEY = keys.ROBINHOOD_API_KEY!.trim();
    }

    const secretResult = validateApiKey("ROBINHOOD_API_SECRET", keys.ROBINHOOD_API_SECRET, RobinhoodSecretSchema);
    if (!secretResult.valid) {
      errors.push({ key: "ROBINHOOD_API_SECRET", message: secretResult.error! });
    } else {
      validated.ROBINHOOD_API_SECRET = keys.ROBINHOOD_API_SECRET!.trim();
    }
  }

  // Validate Webull keys (must be paired) — non-empty with min length
  const hasWebullKey = !!keys.WEBULL_API_KEY;
  const hasWebullSecret = !!keys.WEBULL_API_SECRET;
  if (hasWebullKey !== hasWebullSecret) {
    errors.push({
      key: hasWebullKey ? "WEBULL_API_SECRET" : "WEBULL_API_KEY",
      message: "Webull API key and secret must both be provided",
    });
  } else if (hasWebullKey && hasWebullSecret) {
    validateApiKeyWarn("WEBULL_API_KEY", keys.WEBULL_API_KEY, WebullKeySchema, warnings, validated);
    validateApiKeyWarn("WEBULL_API_SECRET", keys.WEBULL_API_SECRET, WebullSecretSchema, warnings, validated);
  }

  // Validate Binance keys (must be paired)
  const hasBinanceKey = !!keys.BINANCE_API_KEY;
  const hasBinanceSecret = !!keys.BINANCE_API_SECRET;

  if (hasBinanceKey !== hasBinanceSecret) {
    errors.push({
      key: hasBinanceKey ? "BINANCE_API_SECRET" : "BINANCE_API_KEY",
      message: "Binance API key and secret must both be provided",
    });
  } else if (hasBinanceKey && hasBinanceSecret) {
    const keyResult = validateApiKey("BINANCE_API_KEY", keys.BINANCE_API_KEY, BinanceKeySchema);
    if (!keyResult.valid) {
      errors.push({ key: "BINANCE_API_KEY", message: keyResult.error! });
    } else {
      validated.BINANCE_API_KEY = keys.BINANCE_API_KEY!.trim();
    }

    const secretResult = validateApiKey("BINANCE_API_SECRET", keys.BINANCE_API_SECRET, BinanceSecretSchema);
    if (!secretResult.valid) {
      errors.push({ key: "BINANCE_API_SECRET", message: secretResult.error! });
    } else {
      validated.BINANCE_API_SECRET = keys.BINANCE_API_SECRET!.trim();
    }
  }

  // Validate Coinbase keys (key + secret + passphrase must all be provided)
  const hasCoinbaseKey = !!keys.COINBASE_API_KEY;
  const hasCoinbaseSecret = !!keys.COINBASE_API_SECRET;
  const hasCoinbasePassphrase = !!keys.COINBASE_PASSPHRASE;
  const coinbaseCount = [hasCoinbaseKey, hasCoinbaseSecret, hasCoinbasePassphrase].filter(Boolean).length;

  if (coinbaseCount > 0 && coinbaseCount < 3) {
    const missing: string[] = [];
    if (!hasCoinbaseKey) missing.push("COINBASE_API_KEY");
    if (!hasCoinbaseSecret) missing.push("COINBASE_API_SECRET");
    if (!hasCoinbasePassphrase) missing.push("COINBASE_PASSPHRASE");
    errors.push({
      key: missing[0]!,
      message: `Coinbase requires API key, secret, and passphrase. Missing: ${missing.join(", ")}`,
    });
  } else if (coinbaseCount === 3) {
    validateApiKeyWarn("COINBASE_API_KEY", keys.COINBASE_API_KEY, CoinbaseKeySchema, warnings, validated);
    validateApiKeyWarn("COINBASE_API_SECRET", keys.COINBASE_API_SECRET, CoinbaseSecretSchema, warnings, validated);
    validateApiKeyWarn("COINBASE_PASSPHRASE", keys.COINBASE_PASSPHRASE, CoinbasePassphraseSchema, warnings, validated);
  }

  // Validate Kraken keys (must be paired) — base64 format
  const hasKrakenKey = !!keys.KRAKEN_API_KEY;
  const hasKrakenSecret = !!keys.KRAKEN_API_SECRET;
  if (hasKrakenKey !== hasKrakenSecret) {
    errors.push({
      key: hasKrakenKey ? "KRAKEN_API_SECRET" : "KRAKEN_API_KEY",
      message: "Kraken API key and secret must both be provided",
    });
  } else if (hasKrakenKey && hasKrakenSecret) {
    validateApiKeyWarn("KRAKEN_API_KEY", keys.KRAKEN_API_KEY, KrakenKeySchema, warnings, validated);
    validateApiKeyWarn("KRAKEN_API_SECRET", keys.KRAKEN_API_SECRET, KrakenSecretSchema, warnings, validated);
  }

  // Validate Bitfinex keys (must be paired)
  const hasBitfinexKey = !!keys.BITFINEX_API_KEY;
  const hasBitfinexSecret = !!keys.BITFINEX_API_SECRET;
  if (hasBitfinexKey !== hasBitfinexSecret) {
    errors.push({
      key: hasBitfinexKey ? "BITFINEX_API_SECRET" : "BITFINEX_API_KEY",
      message: "Bitfinex API key and secret must both be provided",
    });
  } else if (hasBitfinexKey && hasBitfinexSecret) {
    validateApiKeyWarn("BITFINEX_API_KEY", keys.BITFINEX_API_KEY, BitfinexKeySchema, warnings, validated);
    validateApiKeyWarn("BITFINEX_API_SECRET", keys.BITFINEX_API_SECRET, BitfinexSecretSchema, warnings, validated);
  }

  // Validate Hyperliquid private key (single key, hex format)
  if (keys.HYPERLIQUID_PRIVATE_KEY) {
    validateApiKeyWarn("HYPERLIQUID_PRIVATE_KEY", keys.HYPERLIQUID_PRIVATE_KEY, HyperliquidKeySchema, warnings, validated);
  }

  if (keys.MOONPAY_API_KEY) {
    const result = validateApiKey("MOONPAY_API_KEY", keys.MOONPAY_API_KEY, MoonPayKeySchema);
    if (!result.valid) {
      errors.push({ key: "MOONPAY_API_KEY", message: result.error! });
    } else {
      validated.MOONPAY_API_KEY = keys.MOONPAY_API_KEY.trim();
    }
  }

  if (keys.MOONPAY_SECRET_KEY) {
    const result = validateApiKey("MOONPAY_SECRET_KEY", keys.MOONPAY_SECRET_KEY, MoonPaySecretSchema);
    if (!result.valid) {
      errors.push({ key: "MOONPAY_SECRET_KEY", message: result.error! });
    } else {
      validated.MOONPAY_SECRET_KEY = keys.MOONPAY_SECRET_KEY.trim();
    }
  }

  if (keys.MOONPAY_WEBHOOK_API_KEY) {
    const result = validateApiKey("MOONPAY_WEBHOOK_API_KEY", keys.MOONPAY_WEBHOOK_API_KEY, MoonPayWebhookApiKeySchema);
    if (!result.valid) {
      errors.push({ key: "MOONPAY_WEBHOOK_API_KEY", message: result.error! });
    } else {
      validated.MOONPAY_WEBHOOK_API_KEY = keys.MOONPAY_WEBHOOK_API_KEY.trim();
    }
  }

  if (keys.MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY) {
    const result = validateApiKey(
      "MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY",
      keys.MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY,
      MoonPayVirtualAccountsPrivateKeySchema,
    );
    if (!result.valid) {
      errors.push({ key: "MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY", message: result.error! });
    } else {
      validated.MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY = keys.MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY.trim();
    }
  }

  if (keys.POLYGON_X402_PRIVATE_KEY) {
    const result = validateApiKey("POLYGON_X402_PRIVATE_KEY", keys.POLYGON_X402_PRIVATE_KEY, PolygonX402PrivateKeySchema);
    if (!result.valid) {
      errors.push({ key: "POLYGON_X402_PRIVATE_KEY", message: result.error! });
    } else {
      validated.POLYGON_X402_PRIVATE_KEY = keys.POLYGON_X402_PRIVATE_KEY.trim();
    }
  }

  // Check if at least one LLM key is present
  if (!keys.OPENAI_API_KEY && !keys.DEDALUS_API_KEY && !keys.INCEPTION_API_KEY) {
    warnings.push({
      key: "LLM",
      message: "No LLM API key configured. Set OPENAI_API_KEY, INCEPTION_API_KEY, or DEDALUS_API_KEY.",
    });
  }

  const configuredLLMKeys = [keys.OPENAI_API_KEY, keys.INCEPTION_API_KEY, keys.DEDALUS_API_KEY].filter(Boolean).length;
  if (configuredLLMKeys > 1) {
    warnings.push({
      key: "LLM",
      message: "Multiple LLM API keys are configured. Gordon will use the provider selected in model settings.",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    keys: validated as ValidatedEnvKeys,
  };
}

/**
 * Check if an API key looks like a placeholder
 */
export function isPlaceholderKey(value: string | undefined): boolean {
  if (!value) return false;
  const lower = value.toLowerCase().trim();
  return (
    lower.includes("your-") ||
    lower.includes("your_") ||
    lower.includes("xxx") ||
    lower.includes("placeholder") ||
    lower.includes("example") ||
    lower === "sk-..." ||
    lower === "dd-..." ||
    lower === "icl-..." ||
    lower === ""
  );
}

/**
 * Validate and sanitize a key value (trim whitespace)
 */
export function sanitizeKeyValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * Get human-readable validation summary
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.valid && result.warnings.length === 0) {
    return "✓ All environment variables are valid";
  }

  if (result.errors.length > 0) {
    lines.push("Errors:");
    for (const error of result.errors) {
      lines.push(`  ✗ ${error.key}: ${error.message}`);
    }
  }

  if (result.warnings.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Warnings:");
    for (const warning of result.warnings) {
      lines.push(`  ⚠ ${warning.key}: ${warning.message}`);
    }
  }

  return lines.join("\n");
}
