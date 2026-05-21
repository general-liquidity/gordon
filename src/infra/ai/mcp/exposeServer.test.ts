import { describe, it, expect } from "bun:test";
import { z } from "zod";
import {
  isMcpExposeEnabled,
  isMcpExecutionAllowed,
  filterExposableTools,
  buildGordonMcpServer,
  EXECUTION_DENY_LIST,
  MCP_EXPOSE_FLAG_ENV,
  MCP_ALLOW_EXECUTION_ENV,
  type MastraLikeTool,
  type ToolRegistry,
} from "./exposeServer.ts";

// -------------------- flag tests --------------------

describe("flag toggles", () => {
  it("isMcpExposeEnabled respects flag", () => {
    expect(isMcpExposeEnabled({})).toBe(false);
    expect(isMcpExposeEnabled({ [MCP_EXPOSE_FLAG_ENV]: "1" })).toBe(true);
    expect(isMcpExposeEnabled({ [MCP_EXPOSE_FLAG_ENV]: "true" })).toBe(true);
  });

  it("isMcpExecutionAllowed respects flag", () => {
    expect(isMcpExecutionAllowed({})).toBe(false);
    expect(isMcpExecutionAllowed({ [MCP_ALLOW_EXECUTION_ENV]: "1" })).toBe(true);
  });
});

// -------------------- registry fixtures --------------------

function makeTool(id: string): MastraLikeTool {
  return {
    id,
    description: `Test tool ${id}`,
    inputSchema: z.object({
      query: z.string().describe("Test input"),
    }),
    execute: async (input) => ({ ok: true, echo: input.query }),
  };
}

const sampleRegistry: ToolRegistry = {
  get_data: makeTool("get_data"),
  scan_market: makeTool("scan_market"),
  execute_plan: makeTool("execute_plan"),
  place_order: makeTool("place_order"),
  cancel_order: makeTool("cancel_order"),
  wallet_transfer: makeTool("wallet_transfer"),
};

// -------------------- filter tests --------------------

describe("filterExposableTools — deny list", () => {
  it("denies all EXECUTION_DENY_LIST tools by default", () => {
    const { exposable, summary } = filterExposableTools(sampleRegistry, {
      allowExecution: false,
    });
    expect(exposable.map((t) => t.id).sort()).toEqual(["get_data", "scan_market"]);
    const deniedIds = summary.denied.map((d) => d.id).sort();
    expect(deniedIds).toEqual([
      "cancel_order",
      "execute_plan",
      "place_order",
      "wallet_transfer",
    ]);
    for (const d of summary.denied) {
      expect(d.reason).toContain("execution-deny-list");
    }
  });

  it("exposes execution tools when allowExecution=true", () => {
    const { exposable } = filterExposableTools(sampleRegistry, {
      allowExecution: true,
    });
    expect(exposable.map((t) => t.id)).toContain("execute_plan");
    expect(exposable.map((t) => t.id)).toContain("place_order");
  });

  it("extraDenyList adds custom denied tools on top of deny-list", () => {
    const { exposable, summary } = filterExposableTools(sampleRegistry, {
      allowExecution: false,
      extraDenyList: ["scan_market"],
    });
    expect(exposable.map((t) => t.id)).toEqual(["get_data"]);
    const denied = summary.denied.find((d) => d.id === "scan_market");
    expect(denied?.reason).toBe("extraDenyList");
  });

  it("allowList restricts to a specific subset", () => {
    const { exposable } = filterExposableTools(sampleRegistry, {
      allowExecution: false,
      allowList: ["get_data"],
    });
    expect(exposable.map((t) => t.id)).toEqual(["get_data"]);
  });

  it("allowList does NOT override the execution deny-list", () => {
    // execute_plan is in EXECUTION_DENY_LIST; even if allowListed, deny
    // unless allowExecution=true.
    const { exposable, summary } = filterExposableTools(sampleRegistry, {
      allowExecution: false,
      allowList: ["execute_plan", "get_data"],
    });
    expect(exposable.map((t) => t.id)).toEqual(["get_data"]);
    const denied = summary.denied.find((d) => d.id === "execute_plan");
    expect(denied?.reason).toContain("execution-deny-list");
  });
});

describe("EXECUTION_DENY_LIST coverage", () => {
  it("includes the canonical safety-critical trading tools", () => {
    for (const id of [
      "execute_plan",
      "place_order",
      "cancel_order",
      "cancel_all_orders",
      "wallet_transfer",
      "approve_plan",
    ]) {
      expect(EXECUTION_DENY_LIST.has(id)).toBe(true);
    }
  });

  it("does NOT include obvious read-only tools", () => {
    for (const id of [
      "get_data",
      "scan_market",
      "get_trending_tokens",
      "get_high_volume_tokens",
      "get_trade_history",
    ]) {
      expect(EXECUTION_DENY_LIST.has(id)).toBe(false);
    }
  });
});

// -------------------- server construction --------------------

describe("buildGordonMcpServer", () => {
  it("returns a server + matching summary", () => {
    const { server, summary } = buildGordonMcpServer(sampleRegistry, {
      name: "gordon-test",
      version: "0.0.1",
      allowExecution: false,
    });
    expect(server).toBeDefined();
    expect(summary.exposed.sort()).toEqual(["get_data", "scan_market"]);
    expect(summary.denied.length).toBe(4);
  });

  it("defaults to allowExecution=false from process env", () => {
    // Without GORDON_MCP_ALLOW_EXECUTION set, deny-list applies.
    const { summary } = buildGordonMcpServer(sampleRegistry);
    expect(summary.exposed).not.toContain("execute_plan");
  });

  it("empty registry produces a valid server with zero exposed tools", () => {
    const { server, summary } = buildGordonMcpServer({});
    expect(server).toBeDefined();
    expect(summary.exposed).toEqual([]);
    expect(summary.denied).toEqual([]);
  });

  it("exposed tool count equals exposable length", () => {
    const { summary } = buildGordonMcpServer(sampleRegistry, {
      allowExecution: true,
    });
    expect(summary.exposed.length).toBe(6); // all sample tools exposed
  });
});
