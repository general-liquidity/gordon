import { describe, it, expect } from "bun:test";

import {
  HEADLESS_REPORT_SCHEMA_VERSION,
  headlessResultToJson,
  type HeadlessResult,
} from "./headless.ts";

function fakeResult(overrides: Partial<HeadlessResult> = {}): HeadlessResult {
  return {
    exitCode: 0,
    threadId: "headless-test",
    startedAt: "2026-05-19T00:00:00.000Z",
    finishedAt: "2026-05-19T00:00:01.234Z",
    durationMs: 1234,
    response: "ok",
    ...overrides,
  };
}

describe("HEADLESS_REPORT_SCHEMA_VERSION", () => {
  it("is a positive integer", () => {
    expect(Number.isInteger(HEADLESS_REPORT_SCHEMA_VERSION)).toBe(true);
    expect(HEADLESS_REPORT_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});

describe("headlessResultToJson", () => {
  it("emits a single-line valid JSON document", () => {
    const out = headlessResultToJson(fakeResult());
    expect(out.includes("\n")).toBe(false);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("includes all required fields on success", () => {
    const parsed = JSON.parse(headlessResultToJson(fakeResult()));
    expect(parsed.schemaVersion).toBe(HEADLESS_REPORT_SCHEMA_VERSION);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.threadId).toBe("headless-test");
    expect(parsed.startedAt).toBe("2026-05-19T00:00:00.000Z");
    expect(parsed.finishedAt).toBe("2026-05-19T00:00:01.234Z");
    expect(parsed.durationMs).toBe(1234);
    expect(parsed.response).toBe("ok");
    expect(parsed.error).toBeUndefined();
  });

  it("emits error and omits response on failure", () => {
    const parsed = JSON.parse(
      headlessResultToJson(fakeResult({ exitCode: 1, response: undefined, error: "boom" })),
    );
    expect(parsed.exitCode).toBe(1);
    expect(parsed.error).toBe("boom");
    expect(parsed.response).toBeUndefined();
  });

  it("emits error on safety-block (exitCode 2)", () => {
    const parsed = JSON.parse(
      headlessResultToJson(fakeResult({ exitCode: 2, response: undefined, error: "Empty prompt" })),
    );
    expect(parsed.exitCode).toBe(2);
    expect(parsed.error).toContain("Empty");
  });

  it("preserves duration measurement", () => {
    const parsed = JSON.parse(headlessResultToJson(fakeResult({ durationMs: 9876 })));
    expect(parsed.durationMs).toBe(9876);
  });

  it("survives a response containing quotes and newlines", () => {
    const tricky = 'Line one\nLine "two" with quotes\nLine three';
    const parsed = JSON.parse(headlessResultToJson(fakeResult({ response: tricky })));
    expect(parsed.response).toBe(tricky);
  });
});
