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

export const TinyfishKeySchema = z
  .string()
  .trim()
  .min(1, "Tinyfish API key cannot be empty");

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
  .min(1, "Alpaca API key cannot be empty");

export const AlpacaSecretSchema = z
  .string()
  .trim()
  .min(1, "Alpaca API secret cannot be empty");

export const SchwabKeySchema = z
  .string()
  .trim()
  .min(1, "Schwab API key cannot be empty");

export const SchwabSecretSchema = z
  .string()
  .trim()
  .min(1, "Schwab API secret cannot be empty");

export const TradierKeySchema = z
  .string()
  .trim()
  .min(1, "Tradier API key cannot be empty");

export const TradierSecretSchema = z
  .string()
  .trim()
  .min(1, "Tradier API secret cannot be empty");

export const TradeStationKeySchema = z
  .string()
  .trim()
  .min(1, "TradeStation API key cannot be empty");

export const TradeStationSecretSchema = z
  .string()
  .trim()
  .min(1, "TradeStation API secret cannot be empty");

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
  .min(1, "Trading 212 API key cannot be empty");

export const Trading212SecretSchema = z
  .string()
  .trim()
  .min(1, "Trading 212 API secret cannot be empty");

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
  .min(1, "IBKR API key/token cannot be empty");

export const IbkrSecretSchema = z
  .string()
  .trim()
  .min(1, "IBKR API secret/session value cannot be empty");

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
  .min(1, "Webull API key cannot be empty");

export const WebullSecretSchema = z
  .string()
  .trim()
  .min(1, "Webull API secret cannot be empty");

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
  TINYFISH_API_KEY: TinyfishKeySchema.optional(),
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

  // Validate Alpaca keys (must be paired)
  const hasAlpacaKey = !!keys.ALPACA_API_KEY;
  const hasAlpacaSecret = !!keys.ALPACA_API_SECRET;
  if (hasAlpacaKey !== hasAlpacaSecret) {
    errors.push({
      key: hasAlpacaKey ? "ALPACA_API_SECRET" : "ALPACA_API_KEY",
      message: "Alpaca API key and secret must both be provided",
    });
  } else if (hasAlpacaKey && hasAlpacaSecret) {
    const keyResult = validateApiKey("ALPACA_API_KEY", keys.ALPACA_API_KEY, AlpacaKeySchema);
    if (!keyResult.valid) {
      errors.push({ key: "ALPACA_API_KEY", message: keyResult.error! });
    } else {
      validated.ALPACA_API_KEY = keys.ALPACA_API_KEY!.trim();
    }

    const secretResult = validateApiKey("ALPACA_API_SECRET", keys.ALPACA_API_SECRET, AlpacaSecretSchema);
    if (!secretResult.valid) {
      errors.push({ key: "ALPACA_API_SECRET", message: secretResult.error! });
    } else {
      validated.ALPACA_API_SECRET = keys.ALPACA_API_SECRET!.trim();
    }
  }

  // Validate Schwab keys (must be paired)
  const hasSchwabKey = !!keys.SCHWAB_API_KEY;
  const hasSchwabSecret = !!keys.SCHWAB_API_SECRET;
  if (hasSchwabKey !== hasSchwabSecret) {
    errors.push({
      key: hasSchwabKey ? "SCHWAB_API_SECRET" : "SCHWAB_API_KEY",
      message: "Schwab API key and secret must both be provided",
    });
  } else if (hasSchwabKey && hasSchwabSecret) {
    const keyResult = validateApiKey("SCHWAB_API_KEY", keys.SCHWAB_API_KEY, SchwabKeySchema);
    if (!keyResult.valid) {
      errors.push({ key: "SCHWAB_API_KEY", message: keyResult.error! });
    } else {
      validated.SCHWAB_API_KEY = keys.SCHWAB_API_KEY!.trim();
    }

    const secretResult = validateApiKey("SCHWAB_API_SECRET", keys.SCHWAB_API_SECRET, SchwabSecretSchema);
    if (!secretResult.valid) {
      errors.push({ key: "SCHWAB_API_SECRET", message: secretResult.error! });
    } else {
      validated.SCHWAB_API_SECRET = keys.SCHWAB_API_SECRET!.trim();
    }
  }

  // Validate Tradier keys (must be paired)
  const hasTradierKey = !!keys.TRADIER_API_KEY;
  const hasTradierSecret = !!keys.TRADIER_API_SECRET;
  if (hasTradierKey !== hasTradierSecret) {
    errors.push({
      key: hasTradierKey ? "TRADIER_API_SECRET" : "TRADIER_API_KEY",
      message: "Tradier API key and secret must both be provided",
    });
  } else if (hasTradierKey && hasTradierSecret) {
    const keyResult = validateApiKey("TRADIER_API_KEY", keys.TRADIER_API_KEY, TradierKeySchema);
    if (!keyResult.valid) {
      errors.push({ key: "TRADIER_API_KEY", message: keyResult.error! });
    } else {
      validated.TRADIER_API_KEY = keys.TRADIER_API_KEY!.trim();
    }

    const secretResult = validateApiKey("TRADIER_API_SECRET", keys.TRADIER_API_SECRET, TradierSecretSchema);
    if (!secretResult.valid) {
      errors.push({ key: "TRADIER_API_SECRET", message: secretResult.error! });
    } else {
      validated.TRADIER_API_SECRET = keys.TRADIER_API_SECRET!.trim();
    }
  }

  // Validate TradeStation keys (must be paired)
  const hasTradeStationKey = !!keys.TRADESTATION_API_KEY;
  const hasTradeStationSecret = !!keys.TRADESTATION_API_SECRET;
  if (hasTradeStationKey !== hasTradeStationSecret) {
    errors.push({
      key: hasTradeStationKey ? "TRADESTATION_API_SECRET" : "TRADESTATION_API_KEY",
      message: "TradeStation API key and secret must both be provided",
    });
  } else if (hasTradeStationKey && hasTradeStationSecret) {
    const keyResult = validateApiKey("TRADESTATION_API_KEY", keys.TRADESTATION_API_KEY, TradeStationKeySchema);
    if (!keyResult.valid) {
      errors.push({ key: "TRADESTATION_API_KEY", message: keyResult.error! });
    } else {
      validated.TRADESTATION_API_KEY = keys.TRADESTATION_API_KEY!.trim();
    }

    const secretResult = validateApiKey("TRADESTATION_API_SECRET", keys.TRADESTATION_API_SECRET, TradeStationSecretSchema);
    if (!secretResult.valid) {
      errors.push({ key: "TRADESTATION_API_SECRET", message: secretResult.error! });
    } else {
      validated.TRADESTATION_API_SECRET = keys.TRADESTATION_API_SECRET!.trim();
    }
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

  // Validate Trading 212 keys (must be paired)
  const hasTrading212Key = !!keys.TRADING212_API_KEY;
  const hasTrading212Secret = !!keys.TRADING212_API_SECRET;
  if (hasTrading212Key !== hasTrading212Secret) {
    errors.push({
      key: hasTrading212Key ? "TRADING212_API_SECRET" : "TRADING212_API_KEY",
      message: "Trading 212 API key and secret must both be provided",
    });
  } else if (hasTrading212Key && hasTrading212Secret) {
    const keyResult = validateApiKey("TRADING212_API_KEY", keys.TRADING212_API_KEY, Trading212KeySchema);
    if (!keyResult.valid) {
      errors.push({ key: "TRADING212_API_KEY", message: keyResult.error! });
    } else {
      validated.TRADING212_API_KEY = keys.TRADING212_API_KEY!.trim();
    }

    const secretResult = validateApiKey("TRADING212_API_SECRET", keys.TRADING212_API_SECRET, Trading212SecretSchema);
    if (!secretResult.valid) {
      errors.push({ key: "TRADING212_API_SECRET", message: secretResult.error! });
    } else {
      validated.TRADING212_API_SECRET = keys.TRADING212_API_SECRET!.trim();
    }
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

  // Validate IBKR keys (must be paired)
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

  // Validate Webull keys (must be paired)
  const hasWebullKey = !!keys.WEBULL_API_KEY;
  const hasWebullSecret = !!keys.WEBULL_API_SECRET;
  if (hasWebullKey !== hasWebullSecret) {
    errors.push({
      key: hasWebullKey ? "WEBULL_API_SECRET" : "WEBULL_API_KEY",
      message: "Webull API key and secret must both be provided",
    });
  } else if (hasWebullKey && hasWebullSecret) {
    const keyResult = validateApiKey("WEBULL_API_KEY", keys.WEBULL_API_KEY, WebullKeySchema);
    if (!keyResult.valid) {
      errors.push({ key: "WEBULL_API_KEY", message: keyResult.error! });
    } else {
      validated.WEBULL_API_KEY = keys.WEBULL_API_KEY!.trim();
    }

    const secretResult = validateApiKey("WEBULL_API_SECRET", keys.WEBULL_API_SECRET, WebullSecretSchema);
    if (!secretResult.valid) {
      errors.push({ key: "WEBULL_API_SECRET", message: secretResult.error! });
    } else {
      validated.WEBULL_API_SECRET = keys.WEBULL_API_SECRET!.trim();
    }
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

  if (keys.TINYFISH_API_KEY) {
    const result = validateApiKey("TINYFISH_API_KEY", keys.TINYFISH_API_KEY, TinyfishKeySchema);
    if (!result.valid) {
      errors.push({ key: "TINYFISH_API_KEY", message: result.error! });
    } else {
      validated.TINYFISH_API_KEY = keys.TINYFISH_API_KEY.trim();
    }
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
