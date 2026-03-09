import { describe, expect, it } from "bun:test";

import { GordonConfigSchema } from "../../types/config.ts";
import { determineWorkflowPhase, isExecutionPhase, resolveLegacyModelRouteForWorkflowPhase } from "./workflowPhase.ts";
import type { GordonContext } from "./types.ts";

function createContext(overrides: Partial<GordonContext> = {}): GordonContext {
  return {
    binance: null,
    exchange: null,
    broker: null,
    agentRails: null,
    llm: {} as GordonContext["llm"],
    config: GordonConfigSchema.parse({}),
    portfolioValue: 0,
    availableCash: 0,
    ...overrides,
  };
}

describe("workflowPhase", () => {
  it("maps preview to planning and live order to execution", () => {
    expect(determineWorkflowPhase(createContext({
      requestedActionId: "trading.preview_market_order",
      requestedTaskScope: "planning",
    }))).toBe("planning");

    expect(determineWorkflowPhase(createContext({
      requestedActionId: "trading.market_order",
      requestedTaskScope: "execution",
    }))).toBe("execution");
  });

  it("exposes execution helper semantics", () => {
    expect(isExecutionPhase("execution")).toBeTrue();
    expect(isExecutionPhase("analysis")).toBeFalse();
  });

  it("returns a legacy route for compaction", () => {
    const route = resolveLegacyModelRouteForWorkflowPhase("compaction");
    expect(route.provider).toBeDefined();
    expect(route.model.length).toBeGreaterThan(0);
  });
});
