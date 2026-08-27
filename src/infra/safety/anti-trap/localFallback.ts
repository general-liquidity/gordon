/**
 * Local-fallback for read-only tools (GORDON_LOCAL_FALLBACK).
 *
 * When the LLM provider is unreachable, lets read-only tools (account,
 * positions, charts, news) return raw structured data so the trader
 * retains visibility into their positions even during provider outages.
 * Anti-vendor-lock-in defense from Faye's coding-agent trap critique
 * applied to trading.
 *
 * MVP scope: provider health check + fallback envelope wrapper. Tools
 * call withReadOnlyFallback() and get back either the LLM-narrated
 * result OR a raw-data envelope when provider is unavailable.
 */

import { flagEnv } from "../../config/flagResolver.ts";

export type ProviderHealth = "available" | "degraded" | "unavailable";

interface HealthCacheEntry {
  health: ProviderHealth;
  checkedAt: number;
}

let healthCache: HealthCacheEntry | null = null;
const HEALTH_TTL_MS = 30_000;

export function isLocalFallbackEnabled(env: NodeJS.ProcessEnv = flagEnv()): boolean {
  return env.GORDON_LOCAL_FALLBACK === "1" || env.GORDON_LOCAL_FALLBACK === "true";
}

export function _resetHealthCacheForTest(): void {
  healthCache = null;
}

/**
 * Probe the LLM provider's base URL. A 2xx-4xx response means reachable
 * (a 401 still indicates the endpoint is responsive); only connection
 * failures, 5xx, and timeouts mark it unavailable. Cached for 30s.
 */
export async function checkProviderHealth(
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<ProviderHealth> {
  if (healthCache && now - healthCache.checkedAt < HEALTH_TTL_MS) {
    return healthCache.health;
  }
  const url = process.env.OPENAI_BASE_URL ?? process.env.GORDON_LOCAL_MODEL_URL ?? "";
  if (url.length === 0) {
    const result: ProviderHealth = "available";
    healthCache = { health: result, checkedAt: now };
    return result;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      const res = await fetchImpl(url, { method: "GET", signal: ctrl.signal });
      const health: ProviderHealth = res.status >= 500 ? "unavailable" : "available";
      healthCache = { health, checkedAt: now };
      return health;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    healthCache = { health: "unavailable", checkedAt: now };
    return "unavailable";
  }
}

export interface FallbackEnvelope<T = unknown> {
  source: "llm" | "fallback";
  data: T;
  toolName: string;
  fallbackReason?: string;
}

/**
 * Run the LLM-narrated path; if the provider is unavailable AND
 * fallback mode is enabled, run the raw-data path instead and tag the
 * result as a fallback envelope. The caller's UI renders raw JSON when
 * source==="fallback".
 */
export async function withReadOnlyFallback<T, R>(
  toolName: string,
  llmFn: () => Promise<T>,
  rawFn: () => Promise<R>,
  env: NodeJS.ProcessEnv = flagEnv(),
): Promise<FallbackEnvelope<T | R>> {
  if (!isLocalFallbackEnabled(env)) {
    const data = await llmFn();
    return { source: "llm", data, toolName };
  }
  const health = await checkProviderHealth();
  if (health === "unavailable") {
    const data = await rawFn();
    return {
      source: "fallback",
      data,
      toolName,
      fallbackReason: "LLM provider unreachable — returning raw structured data without narration",
    };
  }
  const data = await llmFn();
  return { source: "llm", data, toolName };
}
