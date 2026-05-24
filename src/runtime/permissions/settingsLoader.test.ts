import { describe, expect, test } from "bun:test";
import {
  loadOperatorSettings,
  summarizeLoadedSettings,
} from "./settingsLoader.ts";

const PROJECT_PATH = "/proj/.claude/settings.json";
const USER_PATH = "/home/user/.claude/settings.json";

function makeOptions(
  files: Record<string, string>,
): Parameters<typeof loadOperatorSettings>[0] {
  return {
    sources: [
      { path: PROJECT_PATH, origin: "project" },
      { path: USER_PATH, origin: "user" },
    ],
    fileContent: new Map(Object.entries(files)),
  };
}

describe("loadOperatorSettings — empty / missing files", () => {
  test("no source files exist → empty result, no warnings", () => {
    const r = loadOperatorSettings({
      sources: [
        { path: PROJECT_PATH, origin: "project" },
        { path: USER_PATH, origin: "user" },
      ],
      fileContent: new Map(),
    });
    expect(r.rules).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.totalAccepted).toBe(0);
    expect(r.sources.every((s) => !s.found)).toBe(true);
  });

  test("file with empty JSON object → no rules, no warnings", () => {
    const r = loadOperatorSettings(makeOptions({ [PROJECT_PATH]: "{}" }));
    expect(r.rules).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  test("file with no interruptOn field → silent skip", () => {
    const r = loadOperatorSettings(
      makeOptions({
        [PROJECT_PATH]: JSON.stringify({ otherField: "value" }),
      }),
    );
    expect(r.rules).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.sources[0]!.found).toBe(true);
    expect(r.sources[0]!.parsed).toBe(true);
    expect(r.sources[0]!.hadInterruptOn).toBe(false);
  });
});

describe("loadOperatorSettings — malformed input", () => {
  test("malformed JSON → warning, no rules", () => {
    const r = loadOperatorSettings(
      makeOptions({ [PROJECT_PATH]: "{ not valid json" }),
    );
    expect(r.rules).toEqual([]);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain("Malformed JSON");
    expect(r.warnings[0]).toContain(PROJECT_PATH);
  });

  test("JSON root is not an object → warning", () => {
    const r = loadOperatorSettings(
      makeOptions({ [PROJECT_PATH]: "[1, 2, 3]" }),
    );
    expect(r.rules).toEqual([]);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain("settings root must be a JSON object");
  });

  test("interruptOn is not an object (string) → warning", () => {
    const r = loadOperatorSettings(
      makeOptions({
        [PROJECT_PATH]: JSON.stringify({ interruptOn: "not-an-object" }),
      }),
    );
    expect(r.rules).toEqual([]);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain("interruptOn must be an object");
  });

  test("interruptOn is an array → warning", () => {
    const r = loadOperatorSettings(
      makeOptions({
        [PROJECT_PATH]: JSON.stringify({ interruptOn: ["nope"] }),
      }),
    );
    expect(r.rules).toEqual([]);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain("array");
  });
});

describe("loadOperatorSettings — basic happy path", () => {
  test("single project file with shorthand interruptOn", () => {
    const r = loadOperatorSettings(
      makeOptions({
        [PROJECT_PATH]: JSON.stringify({
          interruptOn: {
            place_order: "deny",
            "research_*": "allow",
          },
        }),
      }),
    );
    expect(r.totalAccepted).toBe(2);
    expect(r.totalRejected).toBe(0);
    expect(r.warnings).toEqual([]);
    expect(r.sources[0]!.hadInterruptOn).toBe(true);
    expect(r.sources[0]!.accepted).toBe(2);
    const byKey = new Map(
      r.rules.map((rule) => [rule.toolName ?? rule.toolNamePattern, rule]),
    );
    expect(byKey.get("place_order")?.decision).toBe("deny");
    expect(byKey.get("research_*")?.decision).toBe("allow");
  });

  test("createdBy is settings.json:<origin> by default", () => {
    const r = loadOperatorSettings(
      makeOptions({
        [PROJECT_PATH]: JSON.stringify({
          interruptOn: { foo: "allow" },
        }),
      }),
    );
    expect(r.rules[0]!.createdBy).toBe("settings.json:project");
  });

  test("createdByOverride applies", () => {
    const r = loadOperatorSettings({
      ...makeOptions({
        [PROJECT_PATH]: JSON.stringify({
          interruptOn: { foo: "allow" },
        }),
      }),
      createdByOverride: "team-policy",
    });
    expect(r.rules[0]!.createdBy).toBe("team-policy");
  });
});

describe("loadOperatorSettings — project + user merge", () => {
  test("project rules win over user on key conflict", () => {
    const r = loadOperatorSettings(
      makeOptions({
        [PROJECT_PATH]: JSON.stringify({
          interruptOn: { place_order: "deny" },
        }),
        [USER_PATH]: JSON.stringify({
          interruptOn: { place_order: "allow" },
        }),
      }),
    );
    // Project's deny should win
    expect(r.rules.length).toBe(1);
    expect(r.rules[0]!.decision).toBe("deny");
    expect(r.rules[0]!.createdBy).toBe("settings.json:project");
    // Conflict warning emitted
    expect(r.warnings.some((w) => w.includes("already defined"))).toBe(true);
    expect(r.totalRejected).toBe(1);
  });

  test("user-only rules are loaded when no project conflict", () => {
    const r = loadOperatorSettings(
      makeOptions({
        [PROJECT_PATH]: JSON.stringify({
          interruptOn: { place_order: "deny" },
        }),
        [USER_PATH]: JSON.stringify({
          interruptOn: { search_memory: "allow" },
        }),
      }),
    );
    expect(r.totalAccepted).toBe(2);
    const byKey = new Map(r.rules.map((rule) => [rule.toolName, rule]));
    expect(byKey.get("place_order")?.createdBy).toBe("settings.json:project");
    expect(byKey.get("search_memory")?.createdBy).toBe("settings.json:user");
  });

  test("only user file present → user rules loaded", () => {
    const r = loadOperatorSettings(
      makeOptions({
        [USER_PATH]: JSON.stringify({
          interruptOn: { search_memory: "allow" },
        }),
      }),
    );
    expect(r.totalAccepted).toBe(1);
    expect(r.rules[0]!.createdBy).toBe("settings.json:user");
  });

  test("project file with invalid + valid entries: valid kept, invalid warned", () => {
    const r = loadOperatorSettings(
      makeOptions({
        [PROJECT_PATH]: JSON.stringify({
          interruptOn: {
            good: "allow",
            bad: "maybe",
          },
        }),
      }),
    );
    expect(r.totalAccepted).toBe(1);
    expect(r.totalRejected).toBe(1);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain(PROJECT_PATH);
    expect(r.warnings[0]).toContain("project");
  });
});

describe("loadOperatorSettings — full rule shape", () => {
  test("object-shaped rules with scope + permissionScope + expiresAt", () => {
    const r = loadOperatorSettings(
      makeOptions({
        [PROJECT_PATH]: JSON.stringify({
          interruptOn: {
            execute_plan: {
              decision: "deny",
              scope: "persistent",
              permissionScope: "livetrade.execute",
              expiresAt: "2026-12-31T00:00:00.000Z",
            },
          },
        }),
      }),
    );
    expect(r.totalAccepted).toBe(1);
    const rule = r.rules[0]!;
    expect(rule.decision).toBe("deny");
    expect(rule.scope).toBe("persistent");
    expect(rule.permissionScope).toBe("livetrade.execute");
    expect(rule.expiresAt).toBe("2026-12-31T00:00:00.000Z");
  });

  test("mixed shorthand + object rules in same file", () => {
    const r = loadOperatorSettings(
      makeOptions({
        [PROJECT_PATH]: JSON.stringify({
          interruptOn: {
            "place_*": "deny",
            execute_plan: { decision: "deny", scope: "persistent" },
          },
        }),
      }),
    );
    expect(r.totalAccepted).toBe(2);
    const byKey = new Map(
      r.rules.map((rule) => [rule.toolName ?? rule.toolNamePattern, rule]),
    );
    expect(byKey.get("place_*")?.toolNamePattern).toBe("place_*");
    expect(byKey.get("execute_plan")?.toolName).toBe("execute_plan");
    expect(byKey.get("execute_plan")?.scope).toBe("persistent");
  });
});

describe("loadOperatorSettings — provenance reporting", () => {
  test("sources array reports per-file accepted + rejected counts", () => {
    const r = loadOperatorSettings(
      makeOptions({
        [PROJECT_PATH]: JSON.stringify({
          interruptOn: { good: "allow", bad: "maybe" },
        }),
        [USER_PATH]: JSON.stringify({
          interruptOn: { another: "deny" },
        }),
      }),
    );
    const projectSource = r.sources.find((s) => s.origin === "project")!;
    const userSource = r.sources.find((s) => s.origin === "user")!;
    expect(projectSource.accepted).toBe(1);
    expect(projectSource.rejected).toBe(1);
    expect(userSource.accepted).toBe(1);
    expect(userSource.rejected).toBe(0);
  });

  test("sources reports found=false for missing files", () => {
    const r = loadOperatorSettings({
      sources: [
        { path: PROJECT_PATH, origin: "project" },
        { path: USER_PATH, origin: "user" },
      ],
      fileContent: new Map([
        [PROJECT_PATH, JSON.stringify({ interruptOn: { x: "allow" } })],
      ]),
    });
    expect(r.sources.find((s) => s.origin === "project")?.found).toBe(true);
    expect(r.sources.find((s) => s.origin === "user")?.found).toBe(false);
  });
});

describe("loadOperatorSettings — precedence ordering", () => {
  test("project source is always processed first even if listed second", () => {
    const r = loadOperatorSettings({
      sources: [
        { path: USER_PATH, origin: "user" },
        { path: PROJECT_PATH, origin: "project" },
      ],
      fileContent: new Map([
        [PROJECT_PATH, JSON.stringify({ interruptOn: { foo: "deny" } })],
        [USER_PATH, JSON.stringify({ interruptOn: { foo: "allow" } })],
      ]),
    });
    // Project deny wins
    expect(r.rules.length).toBe(1);
    expect(r.rules[0]!.decision).toBe("deny");
  });
});

describe("summarizeLoadedSettings", () => {
  test("renders rule count + sources found", () => {
    const r = loadOperatorSettings(
      makeOptions({
        [PROJECT_PATH]: JSON.stringify({
          interruptOn: { foo: "allow", bar: "deny" },
        }),
      }),
    );
    const text = summarizeLoadedSettings(r);
    expect(text).toContain("2 rules");
    expect(text).toContain("1/2 sources");
  });

  test("renders drops + warnings when present", () => {
    const r = loadOperatorSettings(
      makeOptions({
        [PROJECT_PATH]: JSON.stringify({
          interruptOn: { good: "allow", bad: "maybe" },
        }),
      }),
    );
    const text = summarizeLoadedSettings(r);
    expect(text).toContain("dropped");
    expect(text).toContain("warning");
  });
});
