import { describe, expect, it } from "bun:test";

import { compileSubagentProfiles, isToolAllowedForAgent } from "./subagentProfiles.ts";

describe("subagentProfiles", () => {
  it("compiles per-agent allowed tool lists and validates access", () => {
    const profiles = compileSubagentProfiles(
      {
        scan_market: "Scanner",
        create_plan: "Planner",
        place_market_order: "Executor",
      },
      {
        Gordon: ["Scanner", "Planner", "Executor"],
        Scanner: ["Gordon"],
        Planner: ["Executor", "Gordon"],
        Executor: ["Gordon"],
      },
    );

    expect(profiles.Scanner?.allowedTools).toContain("scan_market");
    expect(isToolAllowedForAgent(profiles, "Executor", "place_market_order")).toBeTrue();
    expect(isToolAllowedForAgent(profiles, "Planner", "scan_market")).toBeFalse();
  });
});
