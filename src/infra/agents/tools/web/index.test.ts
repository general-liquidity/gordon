/**
 * web tool-surface shape test — ids, registry keys, and that execute
 * delegates into the service (the not-configured search path is the
 * cheapest no-network delegation to assert).
 */

import { describe, expect, it } from "bun:test";

import { webTools, webFetchTool, webSearchTool } from "./index.ts";

describe("web tool surface", () => {
  it("exposes exactly web_fetch + web_search under matching ids", () => {
    expect(Object.keys(webTools).sort()).toEqual(["web_fetch", "web_search"]);
    expect(webFetchTool.id).toBe("web_fetch");
    expect(webSearchTool.id).toBe("web_search");
  });

  it("web_search execute delegates into the service (not-configured path)", async () => {
    const prev = process.env.GORDON_WEB_SEARCH_ENDPOINT;
    delete process.env.GORDON_WEB_SEARCH_ENDPOINT;
    try {
      const res = (await webSearchTool.execute!({ query: "btc" } as never, {} as never)) as {
        notConfigured: boolean;
        ok: boolean;
      };
      expect(res.ok).toBe(false);
      expect(res.notConfigured).toBe(true);
    } finally {
      if (prev !== undefined) process.env.GORDON_WEB_SEARCH_ENDPOINT = prev;
    }
  });
});
