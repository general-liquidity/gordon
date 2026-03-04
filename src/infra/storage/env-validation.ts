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

// Combined environment schema
export const EnvKeysSchema = z.object({
  OPENAI_API_KEY: OpenAIKeySchema.optional(),
  DEDALUS_API_KEY: DedalusKeySchema.optional(),
  INCEPTION_API_KEY: InceptionKeySchema.optional(),
  BINANCE_API_KEY: BinanceKeySchema.optional(),
  BINANCE_API_SECRET: BinanceSecretSchema.optional(),
  TINYFISH_API_KEY: TinyfishKeySchema.optional(),
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
