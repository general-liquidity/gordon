import { describe, expect, test } from "bun:test";
import { groupPaletteItems, type PaletteItem } from "./CommandPalette.tsx";
import type { FrecencyMap } from "../utils/frecency.ts";

// Two commands that produce an identical fuzzy score for the query "scan"
// (same length, same boundary bonus) so ordering is decided by the tiebreaker.
const items: PaletteItem[] = [
  { id: "scan-one", label: "/scan-one", workflowId: "discover" },
  { id: "scan-two", label: "/scan-two", workflowId: "discover" },
];

function discoverLabels(groups: ReturnType<typeof groupPaletteItems>): string[] {
  return groups.find((g) => g.group === "discover")?.items.map((i) => i.label) ?? [];
}

describe("groupPaletteItems frecency ordering", () => {
  test("without frecency, equally-scored matches keep insertion order", () => {
    expect(discoverLabels(groupPaletteItems(items, "scan"))).toEqual([
      "/scan-one",
      "/scan-two",
    ]);
  });

  test("a recently-used command ranks above an equal-score never-used one", () => {
    const frecency: FrecencyMap = new Map([
      ["scan-two", { usageCount: 3, lastUsed: Date.now() }],
    ]);
    expect(discoverLabels(groupPaletteItems(items, "scan", frecency))).toEqual([
      "/scan-two",
      "/scan-one",
    ]);
  });

  test("frecency does not override a stronger fuzzy match", () => {
    // "/scan" is an exact-ish stronger match than "/scan-two"; even with heavy
    // frecency on the weaker item, the stronger match stays first.
    const withExact: PaletteItem[] = [
      { id: "scan", label: "/scan", workflowId: "discover" },
      { id: "scan-two", label: "/scan-two", workflowId: "discover" },
    ];
    const frecency: FrecencyMap = new Map([
      ["scan-two", { usageCount: 50, lastUsed: Date.now() }],
    ]);
    expect(discoverLabels(groupPaletteItems(withExact, "scan", frecency))[0]).toBe("/scan");
  });
});
