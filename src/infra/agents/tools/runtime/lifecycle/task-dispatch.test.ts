import { describe, expect, test } from "bun:test";
import { buildTaskDispatchTool, shouldRegisterTaskDispatchTool } from "./task-dispatch.ts";
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

  test("unknown role returns refused without dispatching (defense-in-depth path)", async () => {
    // After Patch 1, the zod enum rejects unknown roles at the schema
    // layer. This test uses an empty profile map so the schema falls
    // back to z.string() and the execute()'s defensive branch is
    // reachable — keeps the defense-in-depth behavior under test.
    const tool = buildTaskDispatchTool(new Map(), FAKE_TOOL_REGISTRY);
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
    const tool = buildTaskDispatchTool(new Map([[PROFILE_A.name, PROFILE_A]]), FAKE_TOOL_REGISTRY);
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

describe("Patch 1 — role schema is a zod enum", () => {
  test("role schema enumerates profile names when non-empty", () => {
    const tool = buildTaskDispatchTool(
      new Map([
        [PROFILE_A.name, PROFILE_A],
        [PROFILE_B.name, PROFILE_B],
      ]),
      FAKE_TOOL_REGISTRY,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputSchema = (tool as any).inputSchema as { shape: { role: any } };
    const roleSchema = inputSchema.shape.role;
    // zod enum exposes `.options` (or `._def.values`) — accept either
    const enumValues = roleSchema._def?.values ?? roleSchema.options ?? roleSchema._def?.entries;
    expect(enumValues).toBeDefined();
    const set = new Set<string>(
      Array.isArray(enumValues) ? enumValues : Object.values(enumValues ?? {}),
    );
    expect(set.has("analyst-a")).toBe(true);
    expect(set.has("analyst-b")).toBe(true);
  });

  test("deprecated profiles excluded from role enum", () => {
    const tool = buildTaskDispatchTool(
      new Map([
        [PROFILE_A.name, PROFILE_A],
        ["dead", { ...PROFILE_A, name: "dead", status: "deprecated" as const }],
      ]),
      FAKE_TOOL_REGISTRY,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputSchema = (tool as any).inputSchema as { shape: { role: any } };
    const roleSchema = inputSchema.shape.role;
    const enumValues = roleSchema._def?.values ?? roleSchema.options ?? roleSchema._def?.entries;
    const set = new Set<string>(
      Array.isArray(enumValues) ? enumValues : Object.values(enumValues ?? {}),
    );
    expect(set.has("analyst-a")).toBe(true);
    expect(set.has("dead")).toBe(false);
  });

  test("empty profile map falls back to z.string()", () => {
    const tool = buildTaskDispatchTool(new Map(), FAKE_TOOL_REGISTRY);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputSchema = (tool as any).inputSchema as { shape: { role: any } };
    const roleSchema = inputSchema.shape.role;
    // string schema does NOT have an enum-style .options/.values
    // (it has _def.typeName === "ZodString").
    const def = roleSchema._def;
    const typeName = def?.typeName ?? def?.type;
    expect(typeName === "ZodString" || typeName === "string").toBe(true);
  });
});

describe("FW7 — shouldRegisterTaskDispatchTool", () => {
  test("non-empty profiles → register", () => {
    expect(shouldRegisterTaskDispatchTool(new Map([[PROFILE_A.name, PROFILE_A]]), {})).toBe(true);
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
