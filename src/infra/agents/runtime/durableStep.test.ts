import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isDurableStepEnabled,
  defaultDurableStepPath,
  hashInput,
  loadStepRecord,
  loadStepRecords,
  executeStep,
  recordToPayload,
  resetInflightForTesting,
  DURABLE_STEP_FLAG_ENV,
  DURABLE_STEP_STORE_PATH_ENV,
} from "./durableStep.ts";

let tempDir: string;
let storePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-durable-step-test-"));
  storePath = join(tempDir, "steps.jsonl");
  resetInflightForTesting();
});

describe("isDurableStepEnabled", () => {
  it("respects the flag", () => {
    expect(isDurableStepEnabled({})).toBe(false);
    expect(isDurableStepEnabled({ [DURABLE_STEP_FLAG_ENV]: "1" })).toBe(true);
    expect(isDurableStepEnabled({ [DURABLE_STEP_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("defaultDurableStepPath", () => {
  it("honors env override", () => {
    expect(defaultDurableStepPath({ [DURABLE_STEP_STORE_PATH_ENV]: "/x.jsonl" })).toBe("/x.jsonl");
  });
  it("falls back to home-dir default", () => {
    expect(defaultDurableStepPath({})).toContain("durable-steps.jsonl");
  });
});

describe("hashInput", () => {
  it("returns identical hash for equal inputs", () => {
    expect(hashInput({ a: 1, b: 2 })).toBe(hashInput({ a: 1, b: 2 }));
  });
  it("returns different hash for different inputs", () => {
    expect(hashInput({ a: 1 })).not.toBe(hashInput({ a: 2 }));
  });
  it("treats undefined as null", () => {
    expect(hashInput(undefined)).toBe(hashInput(null));
  });
  it("returns 8-char hex", () => {
    expect(hashInput("anything")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("executeStep — cache miss", () => {
  it("runs the function and persists", async () => {
    let calls = 0;
    const r = await executeStep({
      stepId: "s-1",
      input: { x: 1 },
      fn: async () => {
        calls++;
        return "result-1";
      },
      storePath,
    });
    expect(r.result).toBe("result-1");
    expect(r.fromCache).toBe(false);
    expect(calls).toBe(1);
    expect(existsSync(storePath)).toBe(true);
  });

  it("creates parent dir if missing", async () => {
    const nested = join(tempDir, "a", "b", "c.jsonl");
    await executeStep({
      stepId: "s-1",
      input: {},
      fn: async () => 1,
      storePath: nested,
    });
    expect(existsSync(nested)).toBe(true);
  });
});

describe("executeStep — cache hit (replay)", () => {
  it("returns cached result without re-executing the function", async () => {
    let calls = 0;
    const fn = async (): Promise<number> => {
      calls++;
      return 42;
    };
    await executeStep({ stepId: "s-1", input: { x: 1 }, fn, storePath });
    resetInflightForTesting(); // simulate process restart
    const r = await executeStep({ stepId: "s-1", input: { x: 1 }, fn, storePath });
    expect(r.result).toBe(42);
    expect(r.fromCache).toBe(true);
    expect(calls).toBe(1);
  });

  it("re-executes when input hash changes (treats as new step)", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return calls;
    };
    await executeStep({ stepId: "s-1", input: { x: 1 }, fn, storePath });
    const r = await executeStep({ stepId: "s-1", input: { x: 2 }, fn, storePath });
    expect(r.fromCache).toBe(false);
    expect(calls).toBe(2);
  });
});

describe("executeStep — in-flight dedupe (concurrency)", () => {
  it("two concurrent calls with same stepId share the same promise", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return calls;
    };
    const [a, b] = await Promise.all([
      executeStep({ stepId: "s-1", input: { x: 1 }, fn, storePath }),
      executeStep({ stepId: "s-1", input: { x: 1 }, fn, storePath }),
    ]);
    expect(calls).toBe(1);
    expect(a.result).toBe(1);
    expect(b.result).toBe(1);
  });
});

describe("executeStep — error handling", () => {
  it("persists an error record and re-throws", async () => {
    await expect(
      executeStep({
        stepId: "s-err",
        input: {},
        fn: async () => {
          throw new Error("boom");
        },
        storePath,
      }),
    ).rejects.toThrow("boom");
    const cached = loadStepRecord("s-err", storePath);
    expect(cached?.error?.message).toBe("boom");
    expect(cached?.result).toBeUndefined();
  });

  it("does NOT replay a failed step from cache (re-executes)", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls === 1) throw new Error("transient");
      return "ok";
    };
    await expect(executeStep({ stepId: "s-1", input: {}, fn, storePath })).rejects.toThrow();
    resetInflightForTesting();
    const r = await executeStep({ stepId: "s-1", input: {}, fn, storePath });
    expect(r.fromCache).toBe(false);
    expect(r.result).toBe("ok");
  });

  it("non-Error throws become Error records", async () => {
    await expect(
      executeStep({
        stepId: "s-x",
        input: {},
        fn: async () => {
          throw "string-error";
        },
        storePath,
      }),
    ).rejects.toBeDefined();
    const cached = loadStepRecord("s-x", storePath);
    expect(cached?.error?.message).toBe("string-error");
  });
});

describe("executeStep — noLog mode", () => {
  it("does not write to disk and does not replay across resets", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return calls;
    };
    await executeStep({ stepId: "s-1", input: {}, fn, noLog: true });
    resetInflightForTesting();
    await executeStep({ stepId: "s-1", input: {}, fn, noLog: true });
    expect(calls).toBe(2);
  });
});

describe("loadStepRecord / loadStepRecords", () => {
  it("returns null / empty for missing file", () => {
    expect(loadStepRecord("nope", join(tempDir, "no.jsonl"))).toBeNull();
    expect(loadStepRecords(join(tempDir, "no.jsonl")).size).toBe(0);
  });

  it("returns the latest record per stepId on duplicate writes", async () => {
    // Force a duplicate by changing the input (which forces re-execution)
    let i = 0;
    const fn = async () => ++i;
    await executeStep({ stepId: "s-1", input: { v: 1 }, fn, storePath });
    await executeStep({ stepId: "s-1", input: { v: 2 }, fn, storePath });
    const records = loadStepRecords(storePath);
    expect(records.size).toBe(1);
    expect(records.get("s-1")!.result).toBe(2);
  });

  it("tolerates malformed lines", async () => {
    await executeStep({ stepId: "s-1", input: {}, fn: async () => 1, storePath });
    const { appendFileSync } = require("node:fs");
    appendFileSync(storePath, "not-json{\n");
    await executeStep({ stepId: "s-2", input: {}, fn: async () => 2, storePath });
    expect(loadStepRecords(storePath).size).toBe(2);
  });
});

describe("recordToPayload", () => {
  it("emits a success payload", async () => {
    await executeStep({ stepId: "s-1", input: {}, fn: async () => "ok", storePath });
    const record = loadStepRecord("s-1", storePath)!;
    const p = recordToPayload(record);
    expect(p.kind).toBe("durable_step.record");
    expect(p.succeeded).toBe(true);
  });

  it("emits a failure payload", async () => {
    await expect(
      executeStep({
        stepId: "s-1",
        input: {},
        fn: async () => {
          throw new Error("x");
        },
        storePath,
      }),
    ).rejects.toThrow();
    const record = loadStepRecord("s-1", storePath)!;
    const p = recordToPayload(record);
    expect(p.succeeded).toBe(false);
    expect(p.errorMessage).toBe("x");
  });
});

describe("readme example — crash-recovery semantics", () => {
  it("two steps; only the un-cached one re-executes after restart", async () => {
    const calls: string[] = [];
    const a = async () => {
      calls.push("a");
      return "A";
    };
    const b = async () => {
      calls.push("b");
      return "B";
    };
    // First "session"
    await executeStep({ stepId: "step-A", input: {}, fn: a, storePath });
    await executeStep({ stepId: "step-B", input: {}, fn: b, storePath });
    expect(calls).toEqual(["a", "b"]);

    // Simulate crash + restart — clear in-flight, third step is new
    resetInflightForTesting();
    let cCalls = 0;
    const c = async () => {
      cCalls++;
      return "C";
    };
    // Replays A and B, executes C fresh
    await executeStep({ stepId: "step-A", input: {}, fn: a, storePath });
    await executeStep({ stepId: "step-B", input: {}, fn: b, storePath });
    await executeStep({ stepId: "step-C", input: {}, fn: c, storePath });
    expect(calls).toEqual(["a", "b"]); // a and b NOT re-called
    expect(cCalls).toBe(1);
  });
});
