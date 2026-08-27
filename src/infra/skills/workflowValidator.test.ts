import { describe, it, expect } from "bun:test";
import { validateWorkflowManifest, validateWorkflowManifests, field } from "./workflowValidator.ts";
import { BUILTIN_WORKFLOWS } from "./workflows/index.ts";
import { discoverSkills } from "./registry.ts";
import type { SkillWorkflowManifest } from "./types.ts";

const SKILLS = ["a", "b", "c"];

function base(overrides: Partial<SkillWorkflowManifest> = {}): SkillWorkflowManifest {
  return {
    id: "wf",
    name: "WF",
    description: "test workflow",
    cadence: "daily",
    steps: [{ skillId: "a" }],
    ...overrides,
  };
}

describe("validateWorkflowManifest — shape", () => {
  it("accepts a minimal valid manifest", () => {
    const r = validateWorkflowManifest(base(), SKILLS);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("rejects an empty step list", () => {
    const r = validateWorkflowManifest(base({ steps: [] }), SKILLS);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "steps")).toBe(true);
  });

  it("rejects a non-kebab id", () => {
    const r = validateWorkflowManifest(base({ id: "Not_Kebab" }), SKILLS);
    expect(r.issues.some((i) => i.field === "id" && i.severity === "error")).toBe(true);
  });

  it("rejects an unknown cadence", () => {
    const r = validateWorkflowManifest(base({ cadence: "hourly" as never }), SKILLS);
    expect(r.issues.some((i) => i.field === "cadence")).toBe(true);
  });

  it("errors when a step references a skill that does not resolve", () => {
    const r = validateWorkflowManifest(base({ steps: [{ skillId: "missing" }] }), SKILLS);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.step === "missing")).toBe(true);
  });

  it("warns on a repeated skill in the chain", () => {
    const r = validateWorkflowManifest(
      base({ steps: [{ skillId: "a" }, { skillId: "a" }] }),
      SKILLS,
    );
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.severity === "warning" && i.step === "a")).toBe(true);
  });
});

describe("validateWorkflowManifest — data-contract integrity", () => {
  it("satisfies a consumed field from an upstream producer", () => {
    const r = validateWorkflowManifest(
      base({
        steps: [
          { skillId: "a", produces: [field("regime", "string")] },
          { skillId: "b", consumes: [field("regime", "string")] },
        ],
      }),
      SKILLS,
    );
    expect(r.ok).toBe(true);
  });

  it("satisfies a consumed field from a workflow input", () => {
    const r = validateWorkflowManifest(
      base({
        inputs: [field("watchlist", "array")],
        steps: [{ skillId: "a", consumes: [field("watchlist", "array")] }],
      }),
      SKILLS,
    );
    expect(r.ok).toBe(true);
  });

  it("errors when a consumed field has no producer", () => {
    const r = validateWorkflowManifest(
      base({ steps: [{ skillId: "a", consumes: [field("regime", "string")] }] }),
      SKILLS,
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "regime")).toBe(true);
  });

  it("errors on a producer/consumer type mismatch", () => {
    const r = validateWorkflowManifest(
      base({
        steps: [
          { skillId: "a", produces: [field("x", "string")] },
          { skillId: "b", consumes: [field("x", "number")] },
        ],
      }),
      SKILLS,
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "x" && /number.*string/.test(i.message))).toBe(true);
  });

  it("only warns when an optional field is unsatisfied", () => {
    const r = validateWorkflowManifest(
      base({
        steps: [{ skillId: "a", consumes: [field("x", "string", { required: false })] }],
      }),
      SKILLS,
    );
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.severity === "warning" && i.field === "x")).toBe(true);
  });

  it("rejects a downstream consume that depends on a later step's produces", () => {
    // ordering matters: b produces `late`, but a (earlier) consumes it → error
    const r = validateWorkflowManifest(
      base({
        steps: [
          { skillId: "a", consumes: [field("late", "string")] },
          { skillId: "b", produces: [field("late", "string")] },
        ],
      }),
      SKILLS,
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.step === "a" && i.field === "late")).toBe(true);
  });

  it("flags duplicate field names within a contract", () => {
    const r = validateWorkflowManifest(
      base({ steps: [{ skillId: "a", produces: [field("x", "string"), field("x", "number")] }] }),
      SKILLS,
    );
    expect(r.issues.some((i) => /duplicate/.test(i.message))).toBe(true);
  });
});

describe("validateWorkflowManifests — batch", () => {
  it("flags duplicate workflow ids across the batch", () => {
    const results = validateWorkflowManifests([base(), base()], SKILLS);
    expect(results[1]!.ok).toBe(false);
    expect(results[1]!.issues.some((i) => /duplicate workflow id/.test(i.message))).toBe(true);
  });
});

describe("BUILTIN_WORKFLOWS — validate against the live registry", () => {
  it("every builtin workflow references resolving skills and is contract-valid", () => {
    const ids = discoverSkills().map((s) => s.id);
    const results = validateWorkflowManifests(BUILTIN_WORKFLOWS, ids);
    for (const r of results) {
      const errors = r.issues.filter((i) => i.severity === "error");
      expect({ workflow: r.workflowId, errors }).toEqual({ workflow: r.workflowId, errors: [] });
    }
  });
});
