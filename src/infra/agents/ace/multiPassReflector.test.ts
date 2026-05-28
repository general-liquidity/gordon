import { describe, expect, test } from "bun:test";
import {
  _synthesizeCategoryClustersForTest,
  runMultiPassReflector,
  type ACELessonCandidate,
} from "./Reflector.ts";

function makeCandidate(
  text: string,
  category: ACELessonCandidate["category"],
  evidenceCount = 1,
  ids: string[] = ["e1"],
): ACELessonCandidate {
  const now = Date.now();
  return {
    text,
    category,
    evidenceCount,
    firstSeenAt: now,
    lastSeenAt: now,
    evidenceEntryIds: ids,
  };
}

describe("_synthesizeCategoryClustersForTest", () => {
  test("returns empty when no category meets the cluster threshold", () => {
    const candidates: ACELessonCandidate[] = [
      makeCandidate("a", "execution_failure"),
      makeCandidate("b", "execution_failure"),
      makeCandidate("c", "risk_event"),
    ];
    expect(_synthesizeCategoryClustersForTest(candidates, 5)).toEqual([]);
  });

  test("emits a meta-candidate when a category meets the cluster threshold", () => {
    const candidates: ACELessonCandidate[] = Array.from({ length: 5 }, (_, i) =>
      makeCandidate(`failure ${i}`, "execution_failure", 1, [`e${i}`]),
    );
    const meta = _synthesizeCategoryClustersForTest(candidates, 5);
    expect(meta).toHaveLength(1);
    expect(meta[0]!.category).toBe("aggregate_pattern");
    expect(meta[0]!.text).toContain("execution_failure");
    expect(meta[0]!.evidenceCount).toBe(5);
    expect(meta[0]!.evidenceEntryIds).toHaveLength(5);
  });

  test("aggregates evidenceCount across the cluster", () => {
    const candidates: ACELessonCandidate[] = [
      makeCandidate("a", "venue_quirk", 3, ["e1"]),
      makeCandidate("b", "venue_quirk", 5, ["e2"]),
      makeCandidate("c", "venue_quirk", 2, ["e3"]),
      makeCandidate("d", "venue_quirk", 1, ["e4"]),
      makeCandidate("e", "venue_quirk", 4, ["e5"]),
    ];
    const meta = _synthesizeCategoryClustersForTest(candidates, 5);
    expect(meta[0]!.evidenceCount).toBe(15); // 3+5+2+1+4
  });

  test("respects a higher cluster threshold", () => {
    const candidates: ACELessonCandidate[] = Array.from({ length: 5 }, (_, i) =>
      makeCandidate(`x ${i}`, "operational"),
    );
    expect(_synthesizeCategoryClustersForTest(candidates, 10)).toEqual([]);
    expect(_synthesizeCategoryClustersForTest(candidates, 4)).toHaveLength(1);
  });

  test("emits one meta-candidate per qualifying category", () => {
    const candidates: ACELessonCandidate[] = [
      ...Array.from({ length: 5 }, (_, i) => makeCandidate(`a ${i}`, "execution_failure")),
      ...Array.from({ length: 5 }, (_, i) => makeCandidate(`b ${i}`, "risk_event")),
      ...Array.from({ length: 3 }, (_, i) => makeCandidate(`c ${i}`, "operational")),
    ];
    const meta = _synthesizeCategoryClustersForTest(candidates, 5);
    expect(meta).toHaveLength(2);
    expect(meta.map((m) => m.text).join(" ")).toContain("execution_failure");
    expect(meta.map((m) => m.text).join(" ")).toContain("risk_event");
  });

  test("deduplicates evidence entry ids across the cluster", () => {
    const candidates: ACELessonCandidate[] = [
      makeCandidate("a", "execution_failure", 1, ["e1", "e2"]),
      makeCandidate("b", "execution_failure", 1, ["e2", "e3"]),
      makeCandidate("c", "execution_failure", 1, ["e3", "e4"]),
      makeCandidate("d", "execution_failure", 1, ["e4", "e5"]),
      makeCandidate("e", "execution_failure", 1, ["e5", "e6"]),
    ];
    const meta = _synthesizeCategoryClustersForTest(candidates, 5);
    // Unique ids: e1..e6, total 6.
    expect(meta[0]!.evidenceEntryIds).toHaveLength(6);
  });
});

describe("runMultiPassReflector — passes option", () => {
  test("passes=1 (default) matches single-pass Reflector behavior (no meta-candidates)", () => {
    // ACE flag is off in tests, so runReflector returns empty. Verify
    // the multi-pass wrapper handles that gracefully.
    const r = runMultiPassReflector({}, { passes: 1 });
    expect(r.passesRun).toBe(1);
    expect(r.metaCandidates).toEqual([]);
  });

  test("passes >= 2 with no base candidates → still no meta-candidates", () => {
    const r = runMultiPassReflector({}, { passes: 3 });
    expect(r.metaCandidates).toEqual([]);
  });

  test("throws on invalid passes", () => {
    expect(() => runMultiPassReflector({}, { passes: 0 })).toThrow(/passes/);
    expect(() => runMultiPassReflector({}, { passes: -1 })).toThrow(/passes/);
    expect(() => runMultiPassReflector({}, { passes: 1.5 })).toThrow(/passes/);
  });
});
