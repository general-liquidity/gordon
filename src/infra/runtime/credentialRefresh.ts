/**
 * Credential Refresh
 *
 * Single entry point that credential-mutating commands (setup wizard,
 * /oauth connect, /exchange add, /broker add, /mcp install, etc.) call
 * after persisting new keys. Ensures the very next tool call picks up
 * fresh credentials without a Gordon restart.
 *
 * Clears every layer of caching that would otherwise hold onto a stale
 * client:
 *   1. Re-reads ~/.gordon/.env into process.env
 *   2. providerRegistry.reset() — re-detects LLM provider availability
 *   3. ExchangeFactory.clearCache() — drops cached Exchange adapters
 *   4. BrokerFactory.clearCache() — drops cached Broker adapters
 *   5. Invalidates the shared GordonContext cache (see
 *      src/gateway/runtime/context.ts) so tools resolve a fresh context
 *   6. Optionally reloadMCPTools() — disconnect + re-init MCP servers
 *
 * This module is intentionally UI-agnostic so /app/commands/* and the
 * TUI can both import it without creating circular dependencies.
 *
 * The TUI holds its own GatewayContextResolver instance — it registers
 * an invalidator via registerContextInvalidator() at startup so this
 * helper can invalidate it without a direct dependency.
 */

import { ExchangeFactory } from "../exchange/factory.ts";
import { BrokerFactory } from "../broker/factory.ts";
import { providerRegistry } from "./providers/registry.ts";
import { loadEnvFile } from "../storage/config/env.ts";

type Invalidator = () => void;

const invalidators = new Set<Invalidator>();

/**
 * Register a GordonContext invalidator. The TUI runtime bridge and the
 * gateway daemon each call this at startup with their own resolver's
 * invalidate method. Returns an unregister function.
 */
export function registerContextInvalidator(fn: Invalidator): () => void {
  invalidators.add(fn);
  return () => {
    invalidators.delete(fn);
  };
}

export interface RefreshCredentialsOptions {
  /** Also disconnect + re-init MCP servers. Default false (slow, external IO). */
  reloadMcp?: boolean;
  /** Re-read ~/.gordon/.env into process.env. Default true. */
  reloadEnv?: boolean;
}

export async function refreshRuntimeCredentials(
  options: RefreshCredentialsOptions = {},
): Promise<void> {
  const { reloadMcp = false, reloadEnv = true } = options;

  // 1. Re-read .env so process.env picks up any newly saved keys
  if (reloadEnv) {
    try {
      await loadEnvFile();
    } catch {
      // Non-critical — worst case, the caller already set process.env directly.
    }
  }

  // 2. LLM provider availability re-detection
  try {
    providerRegistry.reset();
  } catch {
    // Non-critical
  }

  // 3 + 4. Venue adapter caches
  try {
    ExchangeFactory.clearCache();
  } catch {
    // Non-critical
  }
  try {
    BrokerFactory.clearCache();
  } catch {
    // Non-critical
  }

  // 5. Fire all registered context invalidators (TUI + daemon)
  for (const fn of invalidators) {
    try {
      fn();
    } catch {
      // Non-critical — one invalidator failing shouldn't block the others
    }
  }

  // 6. MCP — opt-in because disconnect + reinit is heavy
  if (reloadMcp) {
    try {
      const { reloadMCPTools } = await import("../ai/mcp/client.ts");
      await reloadMCPTools();
    } catch {
      // Non-critical — MCP will reconnect on next tool call or restart
    }
  }
}
