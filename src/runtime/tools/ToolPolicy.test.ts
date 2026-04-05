import { describe, expect, it } from "bun:test";
import { GordonConfigSchema } from "../../types/index.ts";
import type { GordonContext } from "../../infra/agents/types.ts";
import { evaluateRuntimeToolPolicy } from "./ToolPolicy.ts";

function createContext(permissionMode: "auto" | "ask" | "strict" = "ask"): GordonContext {
  const config = GordonConfigSchema.parse({
    mode,
    
  });
  return {
    binance: null,
    exchange: null,
    broker: null,
    agentRails: null,
    llm: {} as GordonContext["llm"],
    config,
    portfolioValue: 10_000,
    availableCash: 5_000,
    userId: "user-test",
    threadId: "thread-test",
  };
}

describe("evaluateRuntimeToolPolicy", () => {
  it("allows read-only market tools in SAFE mode", async () => {
    const decision = await evaluateRuntimeToolPolicy("scan_market", createContext("SAFE"));
    expect(decision.allowed).toBe(true);
    expect(decision.tool.permissionScope).toBe("market.read");
    expect(decision.approvalClass).toBe("none");
  });

  it("blocks live execution tools in SAFE mode", async () => {
    const decision = await evaluateRuntimeToolPolicy("place_market_order", createContext("SAFE"));
    expect(decision.allowed).toBe(false);
    expect(decision.tool.permissionScope).toBe("livetrade.execute");
    expect(decision.approvalClass).toBe("per_action");
  });
});
