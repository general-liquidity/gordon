import { describe, it, expect } from "bun:test";
import { _internal } from "./prompts.ts";
import type { Skill } from "../../skills/types.ts";

const { skillArgumentsSchema, renderSkillBodyWithArgs } = _internal;

function makeSkill(overrides: Partial<Skill> & { id?: string } = {}): Skill {
  return {
    id: overrides.id ?? "test-skill",
    name: overrides.name ?? "Test Skill",
    description: overrides.description ?? "A test skill",
    body: overrides.body ?? "Default body",
    frontmatter: overrides.frontmatter ?? {
      name: overrides.id ?? "test-skill",
      description: "A test skill",
    },
    source: overrides.source ?? "builtin",
    filePath: overrides.filePath ?? "/tmp/test-skill/SKILL.md",
  };
}

describe("skillArgumentsSchema", () => {
  it("returns undefined when skill has no arguments", () => {
    const schema = skillArgumentsSchema(makeSkill());
    expect(schema).toBeUndefined();
  });

  it("returns single-arg schema when arguments is a string", () => {
    const skill = makeSkill({
      frontmatter: { name: "x", description: "y", arguments: "symbol" },
    });
    const schema = skillArgumentsSchema(skill);
    expect(schema).toBeDefined();
    expect(Object.keys(schema!)).toEqual(["symbol"]);
  });

  it("returns multi-arg schema when arguments is an array", () => {
    const skill = makeSkill({
      frontmatter: { name: "x", description: "y", arguments: ["symbol", "timeframe"] },
    });
    const schema = skillArgumentsSchema(skill);
    expect(schema).toBeDefined();
    expect(Object.keys(schema!).sort()).toEqual(["symbol", "timeframe"]);
  });

  it("skips empty strings in arg list", () => {
    const skill = makeSkill({
      frontmatter: { name: "x", description: "y", arguments: ["symbol", "", "timeframe"] },
    });
    const schema = skillArgumentsSchema(skill);
    expect(Object.keys(schema!).sort()).toEqual(["symbol", "timeframe"]);
  });
});

describe("renderSkillBodyWithArgs", () => {
  it("passes body through when no args provided", () => {
    const skill = makeSkill({ body: "Hello world" });
    const out = renderSkillBodyWithArgs(skill, {});
    expect(out).toBe("Hello world");
  });

  it("substitutes $ARGUMENTS with concatenated args", () => {
    const skill = makeSkill({ body: "Analyze $ARGUMENTS now" });
    const out = renderSkillBodyWithArgs(skill, { symbol: "BTC", timeframe: "1h" });
    expect(out).toBe("Analyze BTC 1h now");
  });

  it("substitutes positional $1, $2", () => {
    const skill = makeSkill({ body: "First: $1, Second: $2" });
    const out = renderSkillBodyWithArgs(skill, { a: "alpha", b: "beta" });
    expect(out).toBe("First: alpha, Second: beta");
  });

  it("substitutes named {placeholders}", () => {
    const skill = makeSkill({ body: "Symbol: {symbol}, Timeframe: {timeframe}" });
    const out = renderSkillBodyWithArgs(skill, { symbol: "BTCUSDT", timeframe: "4h" });
    expect(out).toBe("Symbol: BTCUSDT, Timeframe: 4h");
  });

  it("handles undefined values gracefully (no substitution noise)", () => {
    const skill = makeSkill({ body: "X={x}, Y={y}" });
    const out = renderSkillBodyWithArgs(skill, { x: "1", y: undefined });
    expect(out).toBe("X=1, Y=");
  });
});
