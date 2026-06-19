import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// GORDON_DIR is resolved at module-load from GORDON_HOME — set it BEFORE the
// dynamic import so the store writes into an isolated temp dir, not ~/.gordon.
let tmp: string;
let mod: typeof import("./sessionMemory.ts");

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "gordon-sessmem-"));
  process.env.GORDON_HOME = tmp;
  mod = await import("./sessionMemory.ts");
});

afterAll(() => {
  delete process.env.GORDON_HOME;
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
});

describe("dedupeSessionMemories", () => {
  it("supersedes restated facts within a category, keeping the newest", async () => {
    const { addSessionMemory, dedupeSessionMemories, getActiveMemories } = mod;

    // Three restatements of the same risk rule (case/whitespace variants).
    addSessionMemory({ category: "risk_preference", content: "Max  2% per trade" });
    // Force a distinct, later extractedAt for the survivor.
    await new Promise((r) => setTimeout(r, 5));
    addSessionMemory({ category: "risk_preference", content: "max 2% PER trade" });
    // A genuinely different fact in the same category must survive untouched.
    addSessionMemory({ category: "risk_preference", content: "No leverage above 3x" });

    const before = getActiveMemories("risk_preference");
    expect(before.length).toBe(3);

    const result = dedupeSessionMemories();
    expect(result.superseded).toBe(1);

    const after = getActiveMemories("risk_preference");
    // One duplicate collapsed → "max 2% per trade" + "no leverage above 3x".
    expect(after.length).toBe(2);
    expect(after.some((m) => /no leverage/i.test(m.content))).toBe(true);

    // Idempotent — a second pass changes nothing.
    expect(dedupeSessionMemories().superseded).toBe(0);
  });
});
