import { describe, expect, it } from "bun:test";
import { repairStructuredOutput, parseJsonLenient, jsonValidator } from "./structuredOutputRepair.ts";

describe("repairStructuredOutput", () => {
  it("succeeds on the first valid output (no repairs)", async () => {
    const r = await repairStructuredOutput({
      produce: async () => '{"a":1}',
      validate: jsonValidator(),
    });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.repairs).toBe(0);
    expect(r.value).toEqual({ a: 1 });
  });

  it("re-asks and recovers after a malformed first output", async () => {
    const outputs = ["{not valid json", '{"a":1}'];
    let i = 0;
    const r = await repairStructuredOutput({
      produce: async (hint) => {
        // the second call should carry the repair hint
        if (i === 1) expect(hint).toBeTruthy();
        return outputs[i++]!;
      },
      validate: jsonValidator(),
    });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    expect(r.repairs).toBe(1);
  });

  it("fails after exhausting maxAttempts on persistently invalid output", async () => {
    const r = await repairStructuredOutput({
      produce: async () => "still not json",
      validate: jsonValidator(),
      maxAttempts: 3,
    });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(3);
    expect(r.history).toHaveLength(3);
    expect(r.error).toBeTruthy();
  });

  it("treats a produce() throw as a failed attempt and re-asks", async () => {
    let i = 0;
    const r = await repairStructuredOutput({
      produce: async () => {
        if (i++ === 0) throw new Error("rate limited");
        return '{"ok":true}';
      },
      validate: jsonValidator(),
    });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
  });

  it("enforces a content schema via the check fn", async () => {
    const validate = jsonValidator<{ side?: string }>((o) =>
      o.side === "long" || o.side === "short" ? null : "`side` must be long|short",
    );
    const outputs = ['{"side":"sideways"}', '{"side":"long"}'];
    let i = 0;
    const r = await repairStructuredOutput({ produce: async () => outputs[i++]!, validate });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ side: "long" });
    expect(r.repairs).toBe(1);
  });
});

describe("parseJsonLenient", () => {
  it("strips code fences and trailing prose", () => {
    const r = parseJsonLenient('```json\n{"x":5}\n```\nHope that helps!');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ x: 5 });
  });
  it("reports when no JSON is present", () => {
    expect(parseJsonLenient("just words").ok).toBe(false);
  });
});
