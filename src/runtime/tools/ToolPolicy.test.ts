import { describe, expect, it } from "bun:test";
import { GordonConfigSchema } from "../../types/index.ts";
import type { GordonContext } from "../../infra/agents/types.ts";
import { evaluateRuntimeToolPolicy } from "./ToolPolicy.ts";

function createContext(permissionMode: "auto" | "ask" | "strict" | "paper" | "observe" | "plan" = "ask"): GordonContext {
  const config = GordonConfigSchema.parse({
    permissionMode,
  });
  return {
    binance: null,
    exchange: null,
    broker: null,
    llm: {} as GordonContext["llm"],
    config,
    portfolioValue: 10_000,
    availableCash: 5_000,
    userId: "user-test",
    threadId: "thread-test",
  };
}

describe("evaluateRuntimeToolPolicy", () => {
  it("allows read-only market tools in strict mode", async () => {
    const decision = await evaluateRuntimeToolPolicy("scan_market", createContext("strict"));
    expect(decision.allowed).toBe(true);
    expect(decision.tool.permissionScope).toBe("market.read");
    expect(decision.approvalClass).toBe("none");
  });

  it("blocks live execution tools in strict mode", async () => {
    const decision = await evaluateRuntimeToolPolicy("place_market_order", createContext("strict"));
    expect(decision.allowed).toBe(false);
    expect(decision.tool.permissionScope).toBe("livetrade.execute");
    expect(decision.approvalClass).toBe("per_action");
  });
});
