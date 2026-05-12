/**
 * withResultCache — HOF that wraps Mastra tools to check
 * `ToolResultCache` before execution. On cache hit within TTL,
 * returns a structured "unchanged since X" envelope without
 * re-running the tool. On miss, executes the tool and stores the
 * result for future calls.
 *
 * Mirrors `withSpill` / `withOutputFiltering`. Activation is gated by
 * `GORDON_TOOL_RESULT_CACHE` env flag — when unset, this wrapper is
 * an identity passthrough so the wiring ships cold and can be toggled
 * on after eval coverage.
 *
 * Session key: derived from Mastra execution context (runId or
 * threadId). Falls back to a process-stable key when neither is
 * available, which means cache hits across calls within the same
 * process. Bias toward broad cache reuse — TTL is per-tool short
 * (3-15s for market reads).
 */

import { getDefaultToolResultCache } from "../../tooling/toolResultCache.ts";
import { createModuleLogger } from "../../../logger/index.ts";

const logger = createModuleLogger("with-result-cache");

interface ToolLike {
  id?: string;
  execute?: (...args: unknown[]) => Promise<unknown> | unknown;
  [key: string]: unknown;
}

interface MaybeMastraCtx {
  runId?: string;
  threadId?: string;
  toolCallId?: string;
}

function isEnabled(): boolean {
  return process.env.GORDON_TOOL_RESULT_CACHE === "1";
}

function deriveSessionKey(ctx: MaybeMastraCtx | undefined): string {
  return ctx?.threadId ?? ctx?.runId ?? "process";
}

function deriveArgs(ctx: unknown, fallback: unknown): unknown {
  // Mastra typically calls execute(args, context). The args object is what
  // identifies the request shape; the context holds runtime metadata.
  // We hash the args, not the context.
  if (typeof ctx === "object" && ctx !== null) {
    const obj = ctx as Record<string, unknown>;
    if ("args" in obj) return obj.args;
  }
  return fallback;
}

/**
 * Wrap a single Mastra tool with cache-before-execute logic. Cache
 * miss → execute → store. Cache hit within TTL → return delta envelope
 * (model sees `{ status: "unchanged", ageSeconds, cachedPayload, ...}`
 * instead of re-fetched data).
 *
 * The wrapper never throws — cache misses on errors / parse failures
 * fall through to the original execute() unchanged.
 */
export function withResultCache<T extends ToolLike>(tool: T): T {
  if (typeof tool.execute !== "function") return tool;
  const originalExecute = tool.execute.bind(tool);
  const toolId = String(tool.id ?? "unknown-tool");

  const wrapped = async (...args: unknown[]): Promise<unknown> => {
    if (!isEnabled()) return originalExecute(...args);

    const rawArgs = args[0];
    const ctx = args[1] as MaybeMastraCtx | undefined;
    const sessionKey = deriveSessionKey(ctx);
    const cacheArgs = deriveArgs(args[0], rawArgs);

    const cache = getDefaultToolResultCache();
    try {
      const hit = cache.lookup({
        toolName: toolId,
        args: cacheArgs,
        sessionKey,
      });
      if (hit.kind === "hit" && hit.delta) {
        logger.debug("Cache hit — returning delta envelope", {
          tool: toolId,
          ageSeconds: hit.delta.ageSeconds,
        });
        return hit.delta;
      }
    } catch (err) {
      logger.warn("Cache lookup threw — proceeding with raw execute", {
        tool: toolId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    const result = await originalExecute(...args);

    // Store on miss. Bypass storing error envelopes so a transient
    // failure isn't cached and replayed as "unchanged" later.
    try {
      const isErrorEnvelope =
        typeof result === "object" &&
        result !== null &&
        (result as { status?: unknown }).status === "error";
      if (!isErrorEnvelope) {
        cache.record({
          toolName: toolId,
          args: cacheArgs,
          sessionKey,
          payload: result,
        });
      }
    } catch (err) {
      logger.warn("Cache store threw — result still returned to caller", {
        tool: toolId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    return result;
  };

  return { ...tool, execute: wrapped } as T;
}

/** Wrap every tool in a bundle. */
export function withResultCacheAll<T extends Record<string, unknown>>(bundle: T): T {
  const out: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(bundle)) {
    out[name] = withResultCache(tool as ToolLike);
  }
  return out as T;
}
