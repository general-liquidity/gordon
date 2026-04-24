/**
 * MCP Discovery Cache
 *
 * Persists discovered MCP tool schemas to disk so cold starts can serve a
 * stale-but-usable answer immediately while a background refresh probes
 * upstream servers. Targets the paper's "<5% startup cost" goal.
 *
 * Cache format (JSON):
 *   {
 *     version: 1,
 *     savedAt: <unix ms>,
 *     fingerprint: "<plugin id:enabled:version|...>" sorted,
 *     tools: { "serverId_toolName": <serialized tool descriptor> }
 *   }
 *
 * `tools` is intentionally a name-keyed object, not the live `Tool` type from
 * @mastra/core/tools — the cache is purely metadata for fast bootstrap. The
 * actual `Tool` instances must always come from a live MCPClient. The cache
 * primarily exists to:
 *
 *   - Identify which servers should be discovered eagerly vs lazily
 *   - Show the user a populated tool list before discovery completes
 *   - Skip expensive `listTools()` calls when nothing has changed since
 *     the last successful discovery
 */

import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface CachedToolDescriptor {
  serverId: string;
  toolName: string;
  description?: string;
}

export interface DiscoveryCacheV1 {
  version: 1;
  savedAt: number;
  fingerprint: string;
  /** Map of fully namespaced tool name → minimal descriptor */
  tools: Record<string, CachedToolDescriptor>;
}

/** Default cache freshness window: 24 hours */
export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function defaultCachePath(): string {
  const home = os.homedir() || ".";
  return path.join(home, ".gordon", "mcp-discovery-cache.json");
}

function getConfiguredTtl(): number {
  const raw = process.env.GORDON_MCP_DISCOVERY_TTL_MS;
  if (!raw) return DEFAULT_CACHE_TTL_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CACHE_TTL_MS;
  return parsed;
}

export interface LoadResult {
  cache: DiscoveryCacheV1 | null;
  fresh: boolean;
  ageMs: number;
  reason?: string;
}

/**
 * Load the discovery cache from disk if present.
 *
 * Returns `cache: null` when:
 *   - The file doesn't exist
 *   - The file is unreadable / malformed JSON
 *   - The cache version is unknown
 *
 * `fresh` is `true` when the file is younger than `ttlMs` AND the
 * fingerprint matches the current installed-plugin set (caller-supplied).
 */
export async function loadDiscoveryCache(
  installedFingerprint: string,
  options: { ttlMs?: number; cachePath?: string } = {},
): Promise<LoadResult> {
  const filePath = options.cachePath ?? defaultCachePath();
  const ttlMs = options.ttlMs ?? getConfiguredTtl();

  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as DiscoveryCacheV1;
    if (parsed?.version !== 1 || typeof parsed.savedAt !== "number") {
      return { cache: null, fresh: false, ageMs: Infinity, reason: "unknown cache version" };
    }
    const ageMs = Date.now() - parsed.savedAt;
    const matchesPlugins = parsed.fingerprint === installedFingerprint;
    const fresh = ageMs < ttlMs && matchesPlugins;
    return {
      cache: parsed,
      fresh,
      ageMs,
      reason: !matchesPlugins ? "fingerprint mismatch" : ageMs >= ttlMs ? "ttl expired" : undefined,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { cache: null, fresh: false, ageMs: Infinity, reason: "no cache file" };
    }
    return { cache: null, fresh: false, ageMs: Infinity, reason: (err as Error).message };
  }
}

/**
 * Save the discovery cache to disk.
 * Creates the parent directory if missing. Best-effort — failures are swallowed.
 */
export async function saveDiscoveryCache(
  fingerprint: string,
  tools: Record<string, CachedToolDescriptor>,
  options: { cachePath?: string } = {},
): Promise<void> {
  const filePath = options.cachePath ?? defaultCachePath();
  const payload: DiscoveryCacheV1 = {
    version: 1,
    savedAt: Date.now(),
    fingerprint,
    tools,
  };

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    // Best-effort write — ignore failures so MCP boot stays robust.
  }
}

/**
 * Delete the discovery cache file. Used by tests and `mcp reset` flows.
 */
export async function clearDiscoveryCache(options: { cachePath?: string } = {}): Promise<void> {
  const filePath = options.cachePath ?? defaultCachePath();
  try {
    await unlink(filePath);
  } catch {
    // Ignore — cache may not exist.
  }
}

/**
 * Build the descriptor map from a live `Tool` map keyed by namespaced name.
 * The Tool object is loosely typed here so this module can run in tests
 * without pulling Mastra at runtime.
 */
export function buildDescriptorsFromLiveTools(
  tools: Record<string, { description?: string }>,
): Record<string, CachedToolDescriptor> {
  const descriptors: Record<string, CachedToolDescriptor> = {};
  for (const [fullName, tool] of Object.entries(tools)) {
    const underscoreIdx = fullName.indexOf("_");
    if (underscoreIdx <= 0) continue;
    const serverId = fullName.substring(0, underscoreIdx);
    const toolName = fullName.substring(underscoreIdx + 1);
    descriptors[fullName] = {
      serverId,
      toolName,
      description: tool?.description,
    };
  }
  return descriptors;
}
