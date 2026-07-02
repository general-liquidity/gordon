import { describe, it, expect } from "bun:test";

import { skillLoaderTools, searchSkillsTool } from "./skill-loader.ts";
import { listSkillSummaries } from "../../../skills/index.ts";

interface SearchResult {
  total: number;
  matches: Array<{ id: string; summary: string; score: number }>;
}

// Mastra's Tool.execute takes (inputData, context) — this codebase's tools
// read inputData directly (see loadSkillTool: `execute: async ({ id }) => ...`).
// Call through with the args and a stub context.
async function run(args: { query: string; top_k: number }): Promise<SearchResult> {
  const exec = searchSkillsTool.execute as (
    input: typeof args,
    ctx?: unknown,
  ) => Promise<SearchResult>;
  return exec(args, {});
}

describe("search_skills", () => {
  it("is registered alongside list_skills / load_skill", () => {
    expect(Object.keys(skillLoaderTools)).toContain("search_skills");
    expect(Object.keys(skillLoaderTools)).toContain("list_skills");
    expect(Object.keys(skillLoaderTools)).toContain("load_skill");
  });

  it("returns at most top_k ranked matches drawn from the real skill catalog", async () => {
    const catalog = listSkillSummaries();
    // Query built from an actual skill id so at least one match is guaranteed.
    const seed = catalog[0]!;
    const res = await run({ query: seed.id.replace(/-/g, " "), top_k: 3 });
    expect(res.matches.length).toBeLessThanOrEqual(3);
    expect(res.total).toBe(res.matches.length);
    // Every returned id resolves to a real skill and carries its summary.
    const ids = new Set(catalog.map((s) => s.id));
    for (const m of res.matches) {
      expect(ids.has(m.id)).toBe(true);
      expect(typeof m.summary).toBe("string");
    }
  });

  it("ranks by relevance — the seed skill surfaces near the top for its own id", async () => {
    const catalog = listSkillSummaries();
    const seed = catalog.find((s) => s.id.includes("-")) ?? catalog[0]!;
    const res = await run({ query: seed.id.replace(/-/g, " "), top_k: 5 });
    expect(res.matches.some((m) => m.id === seed.id)).toBe(true);
  });

  it("caps results (it ranks, not enumerates the whole catalog)", async () => {
    const catalogSize = listSkillSummaries().length;
    const res = await run({ query: "backtest validation", top_k: 5 });
    expect(res.matches.length).toBeLessThanOrEqual(5);
    expect(res.matches.length).toBeLessThanOrEqual(catalogSize);
  });
});
