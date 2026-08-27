import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadDiscoveryCache,
  saveDiscoveryCache,
  buildDescriptorsFromLiveTools,
  clearDiscoveryCache,
  DEFAULT_CACHE_TTL_MS,
} from "./discoveryCache.ts";

let tempDir = "";
let cachePath = "";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-mcp-cache-"));
  cachePath = join(tempDir, "mcp-discovery-cache.json");
});

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

describe("MCP discoveryCache", () => {
  it("returns cache: null when file does not exist", async () => {
    const result = await loadDiscoveryCache("fp-1", { cachePath });
    expect(result.cache).toBeNull();
    expect(result.fresh).toBe(false);
    expect(result.reason).toBe("no cache file");
  });

  it("round-trips a saved cache", async () => {
    const descriptors = {
      axiom_query: { serverId: "axiom", toolName: "query", description: "Run KQL" },
      exa_search: { serverId: "exa", toolName: "search" },
    };
    await saveDiscoveryCache("fp-A", descriptors, { cachePath });

    const result = await loadDiscoveryCache("fp-A", { cachePath });
    expect(result.cache).not.toBeNull();
    expect(result.fresh).toBe(true);
    expect(result.cache?.tools).toEqual(descriptors);
    expect(result.cache?.fingerprint).toBe("fp-A");
  });

  it("flags fingerprint mismatch as stale even within TTL", async () => {
    await saveDiscoveryCache("fp-A", { x_y: { serverId: "x", toolName: "y" } }, { cachePath });
    const result = await loadDiscoveryCache("fp-DIFFERENT", { cachePath });
    expect(result.cache).not.toBeNull();
    expect(result.fresh).toBe(false);
    expect(result.reason).toBe("fingerprint mismatch");
  });

  it("flags expired cache when older than ttlMs", async () => {
    await saveDiscoveryCache("fp-A", { x_y: { serverId: "x", toolName: "y" } }, { cachePath });
    const result = await loadDiscoveryCache("fp-A", { cachePath, ttlMs: 0 });
    expect(result.cache).not.toBeNull();
    expect(result.fresh).toBe(false);
    expect(result.reason).toBe("ttl expired");
  });

  it("default ttl is 24h", () => {
    expect(DEFAULT_CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("buildDescriptorsFromLiveTools splits namespaced names", () => {
    const tools = {
      axiom_query: { description: "Run KQL" },
      exa_search: { description: "Web search" },
      noUnderscoreToolIgnored: { description: "should be skipped" },
    };
    const descriptors = buildDescriptorsFromLiveTools(tools);
    expect(Object.keys(descriptors).sort()).toEqual(["axiom_query", "exa_search"]);
    expect(descriptors.axiom_query).toEqual({
      serverId: "axiom",
      toolName: "query",
      description: "Run KQL",
    });
  });

  it("clearDiscoveryCache removes file silently when missing", async () => {
    await clearDiscoveryCache({ cachePath }); // no error
    await saveDiscoveryCache("fp-A", { x_y: { serverId: "x", toolName: "y" } }, { cachePath });
    await clearDiscoveryCache({ cachePath });
    const result = await loadDiscoveryCache("fp-A", { cachePath });
    expect(result.cache).toBeNull();
  });

  it("ignores malformed JSON", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, "{ not valid json", "utf-8");
    const result = await loadDiscoveryCache("fp-A", { cachePath });
    expect(result.cache).toBeNull();
  });

  it("rejects unknown cache version", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({ version: 99, savedAt: Date.now(), fingerprint: "x", tools: {} }),
      "utf-8",
    );
    const result = await loadDiscoveryCache("x", { cachePath });
    expect(result.cache).toBeNull();
    expect(result.reason).toBe("unknown cache version");
  });
});
