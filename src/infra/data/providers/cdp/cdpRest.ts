/**
 * Coinbase Developer Platform — REST helper
 *
 * Several CDP products (Webhooks, SQL API, Onramp) are only exposed via REST,
 * not through @coinbase/cdp-sdk's typed namespaces. This module provides a
 * tiny authenticated fetch wrapper that handles:
 *
 *   - JWT generation via @coinbase/cdp-sdk/auth (ECDSA / Ed25519, per key type)
 *   - Base URL selection per product (CDP core vs Onramp host)
 *   - Tier-aware error messages so "not configured" is distinguishable from
 *     "configured but 402/403 because your plan doesn't cover this endpoint"
 *
 * Credentials come from CDP_API_KEY_ID + CDP_API_KEY_SECRET env vars
 * (already used by AgentKit). If either is missing, calls return a
 * structured { configured: false } response instead of throwing, so tools
 * degrade gracefully like the X social tools.
 */

import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { createModuleLogger } from "../../../logger/index.ts";

const logger = createModuleLogger("cdp-rest");

// ============================================================================
// Host selection
// ============================================================================

const CDP_API_HOST = "api.cdp.coinbase.com";
/** Onramp lives on a separate host. */
const CDP_ONRAMP_HOST = "api.developer.coinbase.com";

export type CdpHost = "platform" | "onramp";

function hostFor(host: CdpHost): string {
  return host === "onramp" ? CDP_ONRAMP_HOST : CDP_API_HOST;
}

// ============================================================================
// Config
// ============================================================================

export interface CdpCredentials {
  apiKeyId: string;
  apiKeySecret: string;
}

function getCredentials(): CdpCredentials | null {
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  if (!apiKeyId || !apiKeySecret) return null;
  return { apiKeyId, apiKeySecret };
}

export function isCdpConfigured(): boolean {
  return getCredentials() !== null;
}

export const CDP_NOT_CONFIGURED_MSG =
  "CDP API not configured. Set CDP_API_KEY_ID and CDP_API_KEY_SECRET in " +
  "~/.gordon/.env to enable Coinbase Developer Platform tools (webhooks, " +
  "SQL API, onramp, policy engine). Create keys at https://portal.cdp.coinbase.com/";

// ============================================================================
// Request
// ============================================================================

export interface CdpRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  host?: CdpHost;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Override timeout (default 30s). */
  timeoutMs?: number;
}

export interface CdpResponse<T> {
  configured: boolean;
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

/**
 * Make an authenticated CDP REST call. Returns a structured result so tools
 * can decide how to render errors without try/catch noise.
 */
export async function cdpRequest<T = unknown>(
  path: string,
  options: CdpRequestOptions = {},
): Promise<CdpResponse<T>> {
  const creds = getCredentials();
  if (!creds) {
    return { configured: false, ok: false, status: 0, error: CDP_NOT_CONFIGURED_MSG };
  }

  const host = hostFor(options.host ?? "platform");
  const method = options.method ?? "GET";

  // Build the path with query string
  let fullPath = path.startsWith("/") ? path : `/${path}`;
  if (options.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) fullPath += `?${s}`;
  }

  try {
    // Build JWT for this specific request path — CDP requires path+method in claims
    const jwt = await generateJwt({
      apiKeyId: creds.apiKeyId,
      apiKeySecret: creds.apiKeySecret,
      requestMethod: method,
      requestHost: host,
      requestPath: fullPath.split("?")[0]!,
      expiresIn: 120,
    });

    const url = `https://${host}${fullPath}`;
    const res = await fetch(url, {
      method,
      headers: {
        "Authorization": `Bearer ${jwt}`,
        "Content-Type": "application/json",
        "User-Agent": "gordon-cli/0.7",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }

    if (!res.ok) {
      const errMsg = extractError(parsed, res.status);
      logger.debug("CDP REST non-OK", { path: fullPath, status: res.status, err: errMsg });
      return { configured: true, ok: false, status: res.status, error: errMsg };
    }

    return { configured: true, ok: true, status: res.status, data: parsed as T };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("CDP REST failed", { path, err: message });
    return { configured: true, ok: false, status: 0, error: `CDP request failed: ${message}` };
  }
}

function extractError(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.errorMessage === "string") return `CDP ${status}: ${b.errorMessage}`;
    if (typeof b.message === "string") return `CDP ${status}: ${b.message}`;
    if (typeof b.error === "string") return `CDP ${status}: ${b.error}`;
  }
  return `CDP ${status}: ${typeof body === "string" ? body.slice(0, 200) : "request failed"}`;
}
