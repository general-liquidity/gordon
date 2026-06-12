/**
 * Prompt Cache Audit
 *
 * Diagnostic tool for verifying that the stable prefix / dynamic context
 * separation produced by `contextBudget.ts` is correctly translated into
 * provider-specific cache control by the transport layer.
 *
 * Each provider expresses prompt caching differently:
 *
 *   - Anthropic     EXPLICIT — `providerOptions.anthropic.cacheControl` on
 *                   the system message OR `cache_control: { type: "ephemeral" }`
 *                   on a `system` content block. Min ~1024 tokens.
 *
 *   - OpenAI        AUTOMATIC — caches transparently when prefix is stable
 *                   and ≥1024 tokens. No markers required. Audit only verifies
 *                   the prefix shape is byte-identical between turns.
 *
 *   - Dedalus       OpenAI-compatible gateway — passes through `extra_body`,
 *                   so when the upstream is Anthropic, the gateway forwards
 *                   `system_blocks` with `cache_control` markers.
 *
 *   - Google        Separate `CachedContent` API — out of scope for this
 *                   audit (a different control flow entirely).
 *
 * Returns a structured report with hashes (so callers can diff between
 * requests) plus a flag indicating whether explicit cache markers are
 * present in the payload — and whether they're EXPECTED for that provider.
 */

import { createHash } from "node:crypto";
import type { GroundedPromptMessage } from "./contextBudget.ts";

export type AuditProviderType =
  | "anthropic"
  | "openai"
  | "dedalus"
  | "google"
  | "unknown";

export interface CacheBlockAuditResult {
  /** SHA-1 hash of the stable prefix block (first system message). */
  stablePrefixHash: string | null;
  /** SHA-1 hash of the dynamic context block (second system message, when present). */
  dynamicBlockHash: string | null;
  /** Number of system messages found. */
  systemMessageCount: number;
  /** True when the payload contains explicit cache_control markers. */
  cacheControlPresent: boolean;
  /** True when this provider EXPECTS explicit cache markers. */
  cacheControlExpected: boolean;
  /** Plain-language audit notes (warnings, info). */
  notes: string[];
  /** Provider this audit was run against. */
  provider: AuditProviderType;
  /** Estimated total characters in the stable prefix (rough proxy for tokens). */
  stablePrefixChars: number;
  /** Roughly: tokens ≈ chars/4. */
  estimatedStablePrefixTokens: number;
  /** True when the stable prefix is large enough to actually trigger a cache hit. */
  prefixLargeEnoughForCache: boolean;
}

const ANTHROPIC_MIN_CACHE_TOKENS = 1024;

function hashContent(content: string): string {
  return createHash("sha1").update(content).digest("hex").slice(0, 16);
}

function asString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : (part as { text?: string }).text ?? "",
      )
      .join("");
  }
  return "";
}

function detectCacheControlPresence(
  message: GroundedPromptMessage | undefined,
): boolean {
  if (!message) return false;
  const opts = (message as unknown as { providerOptions?: Record<string, unknown> }).providerOptions;
  if (!opts || typeof opts !== "object") return false;

  // Anthropic: providerOptions.anthropic.cacheControl
  const anthropic = (opts as { anthropic?: { cacheControl?: unknown } }).anthropic;
  if (anthropic?.cacheControl) return true;

  // Content-block-level cache_control (Anthropic native)
  if (Array.isArray(message.content)) {
    for (const part of message.content as unknown as Array<Record<string, unknown>>) {
      if (part && typeof part === "object" && "cache_control" in part && part.cache_control) {
        return true;
      }
    }
  }

  return false;
}

function inferProviderType(provider: string | undefined): AuditProviderType {
  if (!provider) return "unknown";
  const lower = provider.toLowerCase();
  if (lower.includes("anthropic") || lower === "claude") return "anthropic";
  if (lower === "openai") return "openai";
  if (lower === "dedalus") return "dedalus";
  if (lower === "google" || lower.includes("gemini")) return "google";
  return "unknown";
}

function expectsExplicitMarkers(provider: AuditProviderType): boolean {
  // Only Anthropic explicitly REQUIRES markers. Dedalus passes them through
  // when the upstream is Anthropic, so we accept marker presence as valid
  // but don't fail the audit when absent (a gateway-dependent decision).
  return provider === "anthropic";
}

/**
 * Audit a request payload against a provider's prompt-caching expectations.
 *
 * Useful for:
 *   - Debugging "why is my cache hit rate low?" (compare hashes turn over turn)
 *   - Verifying the transport layer hasn't dropped cache_control markers
 *   - Confirming a stable prefix actually meets provider min-token thresholds
 */
export function auditCacheBlocks(
  messages: GroundedPromptMessage[],
  providerType: AuditProviderType | string = "unknown",
): CacheBlockAuditResult {
  const provider = typeof providerType === "string" && (
    providerType === "anthropic" ||
    providerType === "openai" ||
    providerType === "dedalus" ||
    providerType === "google" ||
    providerType === "unknown"
  )
    ? providerType
    : inferProviderType(providerType);

  const systemMessages = messages.filter((m) => m.role === "system");
  const stablePrefix = systemMessages[0];
  const dynamicBlock = systemMessages[1];
  const stablePrefixContent = stablePrefix ? asString(stablePrefix.content) : "";
  const dynamicBlockContent = dynamicBlock ? asString(dynamicBlock.content) : "";

  const stablePrefixHash = stablePrefixContent ? hashContent(stablePrefixContent) : null;
  const dynamicBlockHash = dynamicBlockContent ? hashContent(dynamicBlockContent) : null;

  const cacheControlPresent =
    detectCacheControlPresence(stablePrefix) ||
    detectCacheControlPresence(dynamicBlock);

  const stablePrefixChars = stablePrefixContent.length;
  const estimatedStablePrefixTokens = Math.ceil(stablePrefixChars / 4);
  const cacheControlExpected = expectsExplicitMarkers(provider);
  const prefixLargeEnoughForCache =
    estimatedStablePrefixTokens >= ANTHROPIC_MIN_CACHE_TOKENS;

  const notes: string[] = [];
  if (systemMessages.length === 0) {
    notes.push("No system messages found — caching cannot be applied.");
  } else if (systemMessages.length === 1) {
    notes.push("Only one system message present (no stable/dynamic split).");
  }
  if (cacheControlExpected && !cacheControlPresent) {
    notes.push(
      `Provider "${provider}" expects explicit cache_control markers but none were found in the payload.`,
    );
  }
  if (!cacheControlExpected && cacheControlPresent) {
    notes.push(
      `Provider "${provider}" does not require cache_control markers — they will be ignored downstream.`,
    );
  }
  if (provider === "openai") {
    notes.push(
      "Caching is automatic for this provider; verify prefix stability across requests by comparing stablePrefixHash.",
    );
  }
  if (provider === "google") {
    notes.push(
      "Google Gemini uses the separate CachedContent API; this audit does not cover that flow.",
    );
  }
  if (cacheControlExpected && !prefixLargeEnoughForCache) {
    notes.push(
      `Stable prefix is ~${estimatedStablePrefixTokens} tokens, below the ~${ANTHROPIC_MIN_CACHE_TOKENS}-token threshold required to hit the cache.`,
    );
  }

  return {
    stablePrefixHash,
    dynamicBlockHash,
    systemMessageCount: systemMessages.length,
    cacheControlPresent,
    cacheControlExpected,
    notes,
    provider,
    stablePrefixChars,
    estimatedStablePrefixTokens,
    prefixLargeEnoughForCache,
  };
}

/**
 * Captures the messages from the most recent buildGroundedPrompt() call so
 * the /cache-audit slash command can inspect them. Stored in-process; cleared
 * on resetLatestAuditedRequest().
 */
interface CapturedRequest {
  messages: GroundedPromptMessage[];
  provider: string;
  threadId?: string;
  capturedAt: number;
}

let _latestCapturedRequest: CapturedRequest | null = null;

export function captureAuditedRequest(
  messages: GroundedPromptMessage[],
  provider: string,
  threadId?: string,
): void {
  _latestCapturedRequest = {
    messages,
    provider,
    threadId,
    capturedAt: Date.now(),
  };
}

export function getLatestAuditedRequest(): CapturedRequest | null {
  return _latestCapturedRequest;
}

export function resetLatestAuditedRequest(): void {
  _latestCapturedRequest = null;
}

export function formatCacheBlockAudit(result: CacheBlockAuditResult): string {
  const lines = [
    "**Prompt Cache Audit**",
    "",
    `Provider: ${result.provider}`,
    `System messages: ${result.systemMessageCount}`,
    `Stable prefix hash: ${result.stablePrefixHash ?? "(none)"}`,
    `Dynamic block hash: ${result.dynamicBlockHash ?? "(none)"}`,
    `Stable prefix size: ${result.stablePrefixChars} chars (~${result.estimatedStablePrefixTokens} tokens)`,
    `Cache markers present: ${result.cacheControlPresent ? "yes" : "no"}`,
    `Cache markers expected: ${result.cacheControlExpected ? "yes" : "no"}`,
    `Prefix large enough to trigger cache: ${result.prefixLargeEnoughForCache ? "yes" : "no"}`,
  ];

  if (result.notes.length > 0) {
    lines.push("", "Notes:");
    for (const note of result.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}
