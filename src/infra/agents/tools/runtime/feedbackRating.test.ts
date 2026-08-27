import { describe, it, expect, beforeEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { feedbackRatingTool, FEEDBACK_PATH_ENV } from "./feedbackRating.ts";
import { shadowPlanTool, _resetLastShadowForTesting } from "./shadowPlan.ts";

let workDir: string;
let fbPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "rate-"));
  fbPath = join(workDir, "feedback.jsonl");
  process.env[FEEDBACK_PATH_ENV] = fbPath;
  _resetLastShadowForTesting();
});

const cleanup = () => {
  delete process.env[FEEDBACK_PATH_ENV];
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
};

const execShadow = (input: Record<string, unknown>) =>
  (shadowPlanTool as unknown as { execute: (i: unknown) => Promise<unknown> }).execute(input);
const execRate = (input: Record<string, unknown>) =>
  (feedbackRatingTool as unknown as { execute: (i: unknown) => Promise<unknown> }).execute(input);

describe("feedbackRatingTool — explicit feedback capture", () => {
  it("records a positive rating against the most recent shadow plan", async () => {
    const shadow = (await execShadow({
      direction: "long",
      symbol: "BTC",
      entry: 65000,
      stop: 63000,
      targets: [67000],
      drivers: [],
      tier: "I",
      edgeType: "structural",
    })) as { planId: string };

    const r = (await execRate({ rating: "+" })) as {
      saved: boolean;
      feedbackId: string;
      targetPlanId: string | null;
      rating: "positive" | "negative";
    };

    expect(r.saved).toBe(true);
    expect(r.targetPlanId).toBe(shadow.planId);
    expect(r.rating).toBe("positive");
    expect(existsSync(fbPath)).toBe(true);
    const line = readFileSync(fbPath, "utf8").trim();
    expect(JSON.parse(line).rating).toBe("positive");
    cleanup();
  });

  it("normalizes alias forms (down, -, negative)", async () => {
    const cases: Array<[string, "positive" | "negative"]> = [
      ["+", "positive"],
      ["-", "negative"],
      ["up", "positive"],
      ["down", "negative"],
    ];
    for (const [input, expected] of cases) {
      const r = (await execRate({ rating: input })) as { rating: "positive" | "negative" };
      expect(r.rating).toBe(expected);
    }
    cleanup();
  });

  it("falls back to null targetPlanId when no recent shadow + no override", async () => {
    const r = (await execRate({ rating: "-" })) as { targetPlanId: string | null };
    expect(r.targetPlanId).toBeNull();
    cleanup();
  });

  it("explicit targetPlanId overrides the most-recent fallback", async () => {
    await execShadow({
      direction: "long",
      symbol: "BTC",
      entry: 65000,
      stop: 63000,
      targets: [67000],
      drivers: [],
      tier: "I",
      edgeType: "structural",
    });
    const r = (await execRate({ rating: "+", targetPlanId: "plan-xyz" })) as {
      targetPlanId: string | null;
    };
    expect(r.targetPlanId).toBe("plan-xyz");
    cleanup();
  });

  it("attaches a comment when supplied", async () => {
    await execShadow({
      direction: "long",
      symbol: "BTC",
      entry: 65000,
      stop: 63000,
      targets: [67000],
      drivers: [],
      tier: "I",
      edgeType: "structural",
    });
    await execRate({ rating: "+", comment: "Liquidity map call was spot on" });
    const line = readFileSync(fbPath, "utf8").trim();
    expect(JSON.parse(line).comment).toBe("Liquidity map call was spot on");
    cleanup();
  });
});
