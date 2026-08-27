import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getNativeInputProcessors,
  getNativeOutputProcessors,
  isNativeProcessorsEnabled,
} from "./nativeProcessors.ts";
import { setCostBudget } from "../../platform/costTracker.ts";

const FLAG = "GORDON_MASTRA_PROCESSORS";
const MODEL_FLAG = "GORDON_MASTRA_PROCESSORS_MODEL";
const BUDGET_FLAG = "GORDON_COST_BUDGET_USD";

let prevFlag: string | undefined;
let prevModel: string | undefined;
let prevBudget: string | undefined;

beforeEach(() => {
  prevFlag = process.env[FLAG];
  prevModel = process.env[MODEL_FLAG];
  prevBudget = process.env[BUDGET_FLAG];
  delete process.env[FLAG];
  delete process.env[MODEL_FLAG];
  delete process.env[BUDGET_FLAG];
  setCostBudget(null);
  // Pin a detection model so the getters never depend on ambient provider keys.
  process.env[MODEL_FLAG] = "openai/gpt-5-nano";
});

afterEach(() => {
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore(FLAG, prevFlag);
  restore(MODEL_FLAG, prevModel);
  restore(BUDGET_FLAG, prevBudget);
  setCostBudget(null);
});

describe("nativeProcessors flag gate", () => {
  test("flag off: getters return empty arrays (identical-to-today)", () => {
    expect(isNativeProcessorsEnabled()).toBe(false);
    expect(getNativeInputProcessors()).toEqual([]);
    expect(getNativeOutputProcessors()).toEqual([]);
  });

  test("flag on via '1' and 'true' both enable", () => {
    process.env[FLAG] = "1";
    expect(isNativeProcessorsEnabled()).toBe(true);
    process.env[FLAG] = "true";
    expect(isNativeProcessorsEnabled()).toBe(true);
    process.env[FLAG] = "TRUE";
    expect(isNativeProcessorsEnabled()).toBe(true);
    process.env[FLAG] = "no";
    expect(isNativeProcessorsEnabled()).toBe(false);
  });
});

describe("input processors", () => {
  test("flag on, no budget: injection + PII + moderation, no cost guard", () => {
    process.env[FLAG] = "1";
    const procs = getNativeInputProcessors();
    const ids: string[] = procs.map((p) => p.id);
    expect(ids).toContain("prompt-injection-detector");
    expect(ids).toContain("pii-detector");
    expect(ids).toContain("moderation");
    expect(ids).not.toContain("token-cost-control");
  });

  test("all detectors run in warn mode (non-destructive, compose not replace)", () => {
    process.env[FLAG] = "1";
    const procs = getNativeInputProcessors();
    for (const p of procs) {
      // No processor should be configured to block/redact/rewrite input.
      expect((p as unknown as { strategy?: string }).strategy ?? "warn").toBe("warn");
    }
  });

  test("cost guard appears when a positive session budget is discoverable", () => {
    process.env[FLAG] = "1";
    setCostBudget({ sessionUsd: 12, action: "halt", warnThresholds: [0.9] });
    const procs = getNativeInputProcessors();
    const ids: string[] = procs.map((p) => p.id);
    expect(ids).toContain("token-cost-control");
  });

  test("cost ceiling falls back to GORDON_COST_BUDGET_USD env", () => {
    process.env[FLAG] = "1";
    process.env[BUDGET_FLAG] = "7";
    const procs = getNativeInputProcessors();
    const ids: string[] = procs.map((p) => p.id);
    expect(ids).toContain("token-cost-control");
  });

  test("zero / disabled budget omits the cost guard", () => {
    process.env[FLAG] = "1";
    process.env[BUDGET_FLAG] = "0";
    setCostBudget(null);
    const procs = getNativeInputProcessors();
    const ids: string[] = procs.map((p) => p.id);
    expect(ids).not.toContain("token-cost-control");
  });
});

describe("output processors", () => {
  test("flag on: batch + PII + moderation for streamed output", () => {
    process.env[FLAG] = "1";
    const procs = getNativeOutputProcessors();
    const ids = procs.map((p) => p.id);
    expect(ids).toContain("batch-parts");
    expect(ids).toContain("pii-detector");
    expect(ids).toContain("moderation");
  });
});
