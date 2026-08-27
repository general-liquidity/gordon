import { describe, expect, test } from "bun:test";
import {
  parseInterruptOnConfig,
  summarizeParsedInterruptOn,
  type InterruptOnConfig,
} from "./interruptOnConfig.ts";

const FIXED_NOW = new Date("2026-05-25T12:00:00.000Z");
const FIXED_ID_GEN = () => {
  let counter = 0;
  return () => `rule-${++counter}`;
};

function withFixedIds() {
  return {
    now: FIXED_NOW,
    idGenerator: FIXED_ID_GEN(),
  };
}

describe("parseInterruptOnConfig — empty / invalid input", () => {
  test("undefined config → no rules, no warnings", () => {
    const r = parseInterruptOnConfig(undefined);
    expect(r.rules).toEqual([]);
    expect(r.acceptedCount).toBe(0);
    expect(r.rejectedCount).toBe(0);
  });

  test("null config → no rules", () => {
    const r = parseInterruptOnConfig(null);
    expect(r.rules).toEqual([]);
  });

  test("empty object → no rules", () => {
    const r = parseInterruptOnConfig({});
    expect(r.rules).toEqual([]);
    expect(r.acceptedCount).toBe(0);
  });

  test("non-object in strict mode → throws", () => {
    expect(() =>
      parseInterruptOnConfig("not-an-object" as unknown as InterruptOnConfig, { strict: true }),
    ).toThrow();
  });
});

describe("parseInterruptOnConfig — shorthand strings", () => {
  test("'allow' shorthand produces allow rule with exact toolName", () => {
    const r = parseInterruptOnConfig({ place_order: "allow" }, withFixedIds());
    expect(r.acceptedCount).toBe(1);
    expect(r.rules[0]).toMatchObject({
      toolName: "place_order",
      decision: "allow",
      scope: "session",
      createdBy: "operator-config",
    });
    expect(r.rules[0]!.toolNamePattern).toBeUndefined();
  });

  test("'deny' shorthand produces deny rule", () => {
    const r = parseInterruptOnConfig({ place_order: "deny" }, withFixedIds());
    expect(r.rules[0]!.decision).toBe("deny");
  });

  test("invalid shorthand string is dropped with warning", () => {
    const r = parseInterruptOnConfig({
      place_order: "maybe" as unknown as "allow",
    });
    expect(r.acceptedCount).toBe(0);
    expect(r.rejectedCount).toBe(1);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain("place_order");
    expect(r.warnings[0]).toContain("allow");
  });

  test("strict mode throws on invalid shorthand", () => {
    expect(() =>
      parseInterruptOnConfig({ place_order: "maybe" as unknown as "allow" }, { strict: true }),
    ).toThrow();
  });
});

describe("parseInterruptOnConfig — glob patterns vs exact names", () => {
  test("glob with * sets toolNamePattern", () => {
    const r = parseInterruptOnConfig({ "cancel_*": "deny" }, withFixedIds());
    expect(r.rules[0]!.toolNamePattern).toBe("cancel_*");
    expect(r.rules[0]!.toolName).toBeUndefined();
  });

  test("glob with ? sets toolNamePattern", () => {
    const r = parseInterruptOnConfig({ "test_?": "allow" }, withFixedIds());
    expect(r.rules[0]!.toolNamePattern).toBe("test_?");
  });

  test("exact name sets toolName", () => {
    const r = parseInterruptOnConfig({ search_memory: "allow" }, withFixedIds());
    expect(r.rules[0]!.toolName).toBe("search_memory");
    expect(r.rules[0]!.toolNamePattern).toBeUndefined();
  });
});

describe("parseInterruptOnConfig — full rule shape", () => {
  test("object with decision + scope", () => {
    const r = parseInterruptOnConfig(
      {
        execute_plan: { decision: "deny", scope: "persistent" },
      },
      withFixedIds(),
    );
    expect(r.rules[0]).toMatchObject({
      toolName: "execute_plan",
      decision: "deny",
      scope: "persistent",
    });
  });

  test("object with permissionScope", () => {
    const r = parseInterruptOnConfig(
      {
        execute_plan: {
          decision: "deny",
          permissionScope: "livetrade.execute",
        },
      },
      withFixedIds(),
    );
    expect(r.rules[0]!.permissionScope).toBe("livetrade.execute");
  });

  test("object with expiresAt", () => {
    const expiry = "2026-12-31T00:00:00.000Z";
    const r = parseInterruptOnConfig(
      { execute_plan: { decision: "deny", expiresAt: expiry } },
      withFixedIds(),
    );
    expect(r.rules[0]!.expiresAt).toBe(expiry);
  });

  test("invalid decision string in object → dropped with warning", () => {
    const r = parseInterruptOnConfig({
      execute_plan: { decision: "maybe" as unknown as "allow" },
    });
    expect(r.acceptedCount).toBe(0);
    expect(r.rejectedCount).toBe(1);
    expect(r.warnings[0]).toContain("decision must be");
  });

  test("invalid scope in object → dropped with warning", () => {
    const r = parseInterruptOnConfig({
      execute_plan: {
        decision: "deny",
        scope: "forever" as unknown as "session",
      },
    });
    expect(r.acceptedCount).toBe(0);
    expect(r.rejectedCount).toBe(1);
    expect(r.warnings[0]).toContain("scope");
  });

  test("invalid expiresAt → dropped with warning", () => {
    const r = parseInterruptOnConfig({
      execute_plan: {
        decision: "deny",
        expiresAt: "not-a-timestamp",
      },
    });
    expect(r.acceptedCount).toBe(0);
    expect(r.warnings[0]).toContain("expiresAt");
  });
});

describe("parseInterruptOnConfig — defaults", () => {
  test("scope defaults to 'session'", () => {
    const r = parseInterruptOnConfig({ search_memory: { decision: "allow" } }, withFixedIds());
    expect(r.rules[0]!.scope).toBe("session");
  });

  test("createdBy defaults to 'operator-config'", () => {
    const r = parseInterruptOnConfig({ search_memory: "allow" }, withFixedIds());
    expect(r.rules[0]!.createdBy).toBe("operator-config");
  });

  test("custom createdBy applied", () => {
    const r = parseInterruptOnConfig(
      { search_memory: "allow" },
      { ...withFixedIds(), createdBy: "team-policy" },
    );
    expect(r.rules[0]!.createdBy).toBe("team-policy");
  });

  test("custom now applied to createdAt", () => {
    const r = parseInterruptOnConfig({ search_memory: "allow" }, withFixedIds());
    expect(r.rules[0]!.createdAt).toBe(FIXED_NOW.toISOString());
  });

  test("custom idGenerator applied", () => {
    const idGen = FIXED_ID_GEN();
    const r = parseInterruptOnConfig(
      {
        first: "allow",
        second: "deny",
        third: { decision: "allow" },
      },
      { now: FIXED_NOW, idGenerator: idGen },
    );
    expect(r.rules.map((rule) => rule.id)).toEqual(["rule-1", "rule-2", "rule-3"]);
  });
});

describe("parseInterruptOnConfig — Deep-Agents-shaped operator config", () => {
  test("composite config with mixed shorthand + objects + globs", () => {
    const config: InterruptOnConfig = {
      // Deny all execution tools by default
      "place_*": "deny",
      "cancel_*": "deny",
      execute_plan: "deny",
      // Allow safe research patterns
      "research_*": "allow",
      search_memory: "allow",
      // Custom rule with explicit scope
      classify_trade_risk: {
        decision: "allow",
        scope: "persistent",
        permissionScope: "analysis.run",
      },
    };
    const r = parseInterruptOnConfig(config, withFixedIds());
    expect(r.acceptedCount).toBe(6);
    expect(r.rejectedCount).toBe(0);
    expect(r.warnings).toEqual([]);

    const byKey = new Map(r.rules.map((rule) => [rule.toolName ?? rule.toolNamePattern, rule]));
    expect(byKey.get("place_*")?.decision).toBe("deny");
    expect(byKey.get("place_*")?.toolNamePattern).toBe("place_*");
    expect(byKey.get("research_*")?.decision).toBe("allow");
    expect(byKey.get("execute_plan")?.toolName).toBe("execute_plan");
    expect(byKey.get("classify_trade_risk")?.scope).toBe("persistent");
    expect(byKey.get("classify_trade_risk")?.permissionScope).toBe("analysis.run");
  });

  test("partial valid + invalid: keeps valid, warns on invalid", () => {
    const config: InterruptOnConfig = {
      good: "allow",
      bad: "maybe" as unknown as "allow",
      "also_good_*": { decision: "deny" },
    };
    const r = parseInterruptOnConfig(config);
    expect(r.acceptedCount).toBe(2);
    expect(r.rejectedCount).toBe(1);
    expect(r.warnings.length).toBe(1);
  });
});

describe("parseInterruptOnConfig — edge cases", () => {
  test("empty string key is dropped", () => {
    const config = { "": "allow" } as unknown as InterruptOnConfig;
    const r = parseInterruptOnConfig(config);
    // Object.entries on an object literal with empty-string key DOES iterate
    // it. Our parser should drop it with a warning.
    expect(r.rejectedCount).toBe(1);
  });

  test("non-string/object value (number) is dropped", () => {
    const config = { foo: 42 as unknown as "allow" };
    const r = parseInterruptOnConfig(config);
    expect(r.rejectedCount).toBe(1);
    expect(r.warnings[0]).toContain("string or object");
  });

  test("null value is dropped (typeof null === 'object' but null fails validateRule)", () => {
    const config = { foo: null as unknown as "allow" };
    const r = parseInterruptOnConfig(config);
    expect(r.rejectedCount).toBe(1);
  });
});

describe("summarizeParsedInterruptOn", () => {
  test("renders accepted-only summary", () => {
    const r = parseInterruptOnConfig({ a: "allow", b: "deny" }, withFixedIds());
    const text = summarizeParsedInterruptOn(r);
    expect(text).toContain("2 rules");
    expect(text).not.toContain("dropped");
    expect(text).not.toContain("warning");
  });

  test("renders with drops + warnings", () => {
    const r = parseInterruptOnConfig({
      good: "allow",
      bad: "maybe" as unknown as "allow",
    });
    const text = summarizeParsedInterruptOn(r);
    expect(text).toContain("1 rule");
    expect(text).toContain("1 dropped");
    expect(text).toContain("1 warning");
  });

  test("singular vs plural rule wording", () => {
    const single = parseInterruptOnConfig({ a: "allow" }, withFixedIds());
    const plural = parseInterruptOnConfig({ a: "allow", b: "deny" }, withFixedIds());
    expect(summarizeParsedInterruptOn(single)).toContain("1 rule.");
    expect(summarizeParsedInterruptOn(plural)).toContain("2 rules.");
  });
});
