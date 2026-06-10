import { describe, expect, it } from "bun:test";
import { evaluateGordonToolAccess } from "../../infra/agents/tools/wrappers/withMetrics.ts";

describe("evaluateGordonToolAccess", () => {
  it("blocks safety-critical tools when Gordon context is missing", async () => {
    const access = await evaluateGordonToolAccess("execute_plan", undefined);
    expect(access.status).toBe("blocked");
    expect(access.reason).toContain("fail-closed");
  });

  it("allows read-only tools when Gordon context is missing", async () => {
    const access = await evaluateGordonToolAccess("get_market_data", undefined);
    expect(access.status).toBe("allowed");
  });
});