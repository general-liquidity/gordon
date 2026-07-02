import { describe, it, expect } from "bun:test";
import { memoryScenarios } from "./memory-source.ts";
import { generateScenarios } from "./index.ts";

describe("memory source", () => {
  it("derives recall / poisoned-recall / oracle-memory probes with provenance", () => {
    const scn = memoryScenarios();
    const keys = scn.map((s) => s.derivedFrom);
    expect(keys).toContain("memory:faithful-recall");
    expect(keys).toContain("memory:poisoned-recall");
    expect(keys).toContain("memory:oracle-lookahead");

    for (const s of scn) {
      expect(s.derivedFrom!.startsWith("memory:")).toBe(true);
      expect(s.category).toBe("memory");
      expect(s.tags).toContain("memory");
      expect(s.extraRubric && s.extraRubric.length).toBeTruthy();
      expect(s.systemPrompt.length).toBeGreaterThan(50);
      expect(s.userInput.length).toBeGreaterThan(10);
    }
  });

  it("flags the poisoned + lookahead cases as adversarial / no-lookahead probes", () => {
    const scn = memoryScenarios();
    expect(scn.find((s) => s.derivedFrom === "memory:poisoned-recall")!.tags).toContain("adversarial");
    expect(scn.find((s) => s.derivedFrom === "memory:oracle-lookahead")!.tags).toContain("no-lookahead");
  });

  it("is wired into the full generator suite via the 'memory' source", () => {
    const memoryOnly = generateScenarios({ sources: ["memory"] });
    expect(memoryOnly.length).toBe(memoryScenarios().length);
    const all = generateScenarios();
    for (const s of memoryOnly) {
      expect(all.some((a) => a.id === s.id)).toBe(true);
    }
  });
});
