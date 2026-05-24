import { describe, expect, test } from "bun:test";
import {
  buildTaskDispatchTool,
  shouldRegisterTaskDispatchTool,
} from "./task-dispatch.ts";
import type { SubagentProfile } from "../../../profiles/subagentProfile.ts";

const PROFILE_A: SubagentProfile = {
  name: "analyst-a",
  description: "Test analyst A",
  instructions: "Analyze.",
  tools: ["scan_market"],
};

const PROFILE_B: SubagentProfile = {
  name: "analyst-b",
  description: "Test analyst B",
  instructions: "Analyze.",
  tools: ["list_skills"],
};

const FAKE_TOOL_REGISTRY: Record<string, unknown> = {
  scan_market: { id: "scan_market" },
  list_skills: { id: "list_skills" },
};

describe("FW7 — buildTaskDispatchTool", () => {
  test("tool description enumerates active profiles", () => {
    const tool = buildTaskDispatchTool(
      new Map([
        [PROFILE_A.name, PROFILE_A],
        [PROFILE_B.name, PROFILE_B],
      ]),
      FAKE_TOOL_REGISTRY,
    );
    expect(tool.description).toContain("analyst-a");
    expect(tool.description).toContain("analyst-b");
    expect(tool.description).toContain("READ-ONLY");
  });

  test("description for empty profile set notes config required", () => {
    const tool = buildTaskDispatchTool(new Map(), FAKE_TOOL_REGISTRY);
    expect(tool.description).toContain("no profiles configured");
  });

  test("description excludes deprecated profiles", () => {
    const tool = buildTaskDispatchTool(
      new Map([
        [PROFILE_A.name, PROFILE_A],
        ["dead-role", { ...PROFILE_A, name: "dead-role", status: "deprecated" }],
      ]),
      FAKE_TOOL_REGISTRY,
    );
    expect(tool.description).toContain("analyst-a");
    expect(tool.description).not.toContain("dead-role");
  });

  test("unknown role returns refused without dispatching", async () => {
    const tool = buildTaskDispatchTool(
      new Map([[PROFILE_A.name, PROFILE_A]]),
      FAKE_TOOL_REGISTRY,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool.execute as any)({
      role: "ghost-role",
      task: "anything",
    });
    expect(result.status).toBe("refused");
    expect(result.error).toContain("Unknown role");
    expect(result.subagentId).toBe("n/a");
  });

  test("output schema fields are populated for refused-unknown", async () => {
    const tool = buildTaskDispatchTool(new Map(), FAKE_TOOL_REGISTRY);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool.execute as any)({
      role: "x",
      task: "y",
    });
    expect(result.toolsAllowed).toBe(0);
    expect(result.toolsBlocked).toBe(0);
    expect(result.toolsUnmatched).toBe(0);
  });

  test("known role with flag off returns 'disabled' status", async () => {
    const tool = buildTaskDispatchTool(
      new Map([[PROFILE_A.name, PROFILE_A]]),
      FAKE_TOOL_REGISTRY,
    );
    const previous = process.env.GORDON_DYNAMIC_SUBAGENTS;
    delete process.env.GORDON_DYNAMIC_SUBAGENTS;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (tool.execute as any)({
        role: "analyst-a",
        task: "scan",
      });
      expect(result.status).toBe("disabled");
      expect(result.toolsAllowed).toBe(1);
    } finally {
      if (previous !== undefined) process.env.GORDON_DYNAMIC_SUBAGENTS = previous;
    }
  });
});

describe("FW7 — shouldRegisterTaskDispatchTool", () => {
  test("non-empty profiles → register", () => {
    expect(
      shouldRegisterTaskDispatchTool(new Map([[PROFILE_A.name, PROFILE_A]]), {}),
    ).toBe(true);
  });

  test("empty profiles + flag off → no register", () => {
    expect(shouldRegisterTaskDispatchTool(new Map(), {})).toBe(false);
  });

  test("empty profiles + flag on → register (lets operator iterate)", () => {
    expect(
      shouldRegisterTaskDispatchTool(new Map(), {
        GORDON_DYNAMIC_SUBAGENTS: "1",
      }),
    ).toBe(true);
  });
});
