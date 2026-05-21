/**
 * GordonContext builder for ACP mode.
 *
 * processMessageStream (orchestrator.ts) needs a GordonContext with the
 * LLM client, config, optional exchange/broker, and a few session
 * descriptors. This builder constructs a sensible default for
 * Gordon-running-as-an-ACP-subprocess:
 *
 *   - llm:      createLLMClientFromEnv() — provider keys from env
 *   - config:   loadConfig() — operator's persisted config from disk
 *   - exchange: null in v2 — operators wanting trading-from-Zed wire
 *               their own adapter via env (deferred follow-up)
 *   - broker:   null in v2
 *   - portfolioValue / availableCash: 0 — no live values; tools that
 *     need them surface an empty-portfolio result instead of crashing
 *
 * Cached per-process — every ACP session shares the same context
 * (matches the TUI's "one config, one config-derived state" model).
 */

import { createLLMClientFromEnv } from "../ai/llm/index.ts";
import { loadConfig } from "../storage/config/config.ts";
import type { GordonContext } from "../agents/types.ts";

let cached: GordonContext | null = null;

/**
 * Build (or return cached) GordonContext for the ACP subprocess.
 *
 * Idempotent. The first call loads config + LLM; subsequent calls
 * return the cached instance unless `force` is true.
 */
export async function getAcpGordonContext(force = false): Promise<GordonContext> {
  if (cached && !force) return cached;
  const llm = createLLMClientFromEnv();
  const config = await loadConfig();
  cached = {
    binance: null,
    exchange: null,
    broker: null,
    agentRails: null,
    llm,
    config,
    portfolioValue: 0,
    availableCash: 0,
    credentialProfile: "paper",
  };
  return cached;
}

/**
 * Drop the cached context — used when config changes mid-session
 * (rare in ACP mode; included for completeness).
 */
export function resetAcpGordonContext(): void {
  cached = null;
}
