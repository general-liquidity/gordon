/**
 * PII Marker Type System
 *
 * Claude Code pattern: use TypeScript brand types to force callers to
 * explicitly attest at compile time that a string field contains no PII
 * before logging it. This catches accidental log-of-sensitive-data at the
 * type-check stage instead of at incident-response stage.
 *
 * Two brand types:
 *
 *   NotPII<T> — caller has verified this value contains no PII, no code,
 *               no file paths, no addresses, no api keys
 *   PII<T>    — caller knows this contains PII; routed only to privileged
 *               sinks that can handle it (1P only, never general analytics)
 *
 * Helpers:
 *
 *   verifiedNotPII(x)  — wrap a value as NotPII; the function NAME is the
 *                        attestation, code review checks each call site
 *   markPII(x)         — wrap a value as PII; only privileged sinks accept
 *
 * Usage in telemetry:
 *
 *   record("scan_complete", {
 *     symbol: verifiedNotPII("BTCUSDT"),     // OK — public market data
 *     userInput: markPII(rawUserText),       // OK — but only privileged sinks see it
 *     // raw string here would be a TYPE ERROR
 *   });
 */

declare const NotPIIBrand: unique symbol;
declare const PIIBrand: unique symbol;

export type NotPII<T = string> = T & { readonly [NotPIIBrand]: true };
export type PII<T = string> = T & { readonly [PIIBrand]: true };

/**
 * Mark a value as verified-not-PII. The act of writing this call IS the
 * attestation. Code review checks each site for correctness.
 */
export function verifiedNotPII<T>(value: T): NotPII<T> {
  return value as NotPII<T>;
}

/**
 * Mark a value as containing PII. Routed only to privileged sinks; rejected
 * by general-access sinks (Datadog-equivalent).
 */
export function markPII<T>(value: T): PII<T> {
  return value as PII<T>;
}

/**
 * Type guard — at runtime, brand types are erased so this just checks that
 * the value is a non-empty string. Use only for sink-internal validation.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Strip any field whose value is a PII brand at runtime cannot be checked,
 * so this works on a property-name basis: any key starting with `pii_` is
 * stripped before being shipped to general-access sinks.
 */
export function stripPIIFields<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("pii_") || k.startsWith("_PII_")) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Sanity check helpers used by sinks before shipping a payload. Catches
 * obvious slips (api keys, emails, wallet addresses) that brand types
 * couldn't catch — e.g., when a value was correctly attested as not-PII
 * but the developer was wrong.
 */
export function looksLikeApiKey(s: string): boolean {
  // sk-..., pk-..., ANTHROPIC-..., etc. Not exhaustive.
  return /(?:^|[^A-Za-z0-9])(sk|pk|ANTHROPIC|OPENAI|GORDON)[-_][A-Za-z0-9]{16,}/.test(s);
}

export function looksLikeEmail(s: string): boolean {
  return /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s);
}

export function looksLikeWalletAddress(s: string): boolean {
  // 0x... EVM, base58 Solana, bech32 BTC. Conservative.
  return /(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}|bc1[a-z0-9]{20,})/.test(s);
}

export function quickPIIScan(value: string): { hit: boolean; reason?: string } {
  if (looksLikeApiKey(value)) return { hit: true, reason: "api_key" };
  if (looksLikeEmail(value)) return { hit: true, reason: "email" };
  if (looksLikeWalletAddress(value)) return { hit: true, reason: "wallet_address" };
  return { hit: false };
}
