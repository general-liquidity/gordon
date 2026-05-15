import { describe, it, expect } from "bun:test";

import {
  isSilentToolFormatterEnabled,
  formatSilent,
  formatSilentPipeline,
  resultToPayload,
  SILENT_TOOL_FORMATTER_FLAG_ENV,
} from "./silentToolResultFormatter.ts";

describe("isSilentToolFormatterEnabled", () => {
  it("respects the flag", () => {
    expect(isSilentToolFormatterEnabled({})).toBe(false);
    expect(isSilentToolFormatterEnabled({ [SILENT_TOOL_FORMATTER_FLAG_ENV]: "1" })).toBe(true);
    expect(isSilentToolFormatterEnabled({ [SILENT_TOOL_FORMATTER_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("formatSilent — success path", () => {
  it("collapses all output to a single ✓ line on exitCode 0", () => {
    const r = formatSilent({
      description: "typecheck",
      output: "no errors\nall good\nstill all good".repeat(50),
      exitCode: 0,
    });
    expect(r.formatted).toBe("✓ typecheck");
    expect(r.succeeded).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.bytesSaved).toBeGreaterThan(0);
  });

  it("treats null exitCode as success", () => {
    const r = formatSilent({
      description: "done",
      output: "things",
      exitCode: null,
    });
    expect(r.succeeded).toBe(true);
    expect(r.formatted).toBe("✓ done");
  });

  it("preserves full output when alwaysShowOutput=true", () => {
    const r = formatSilent({
      description: "snapshot",
      output: "snapshot content",
      exitCode: 0,
      alwaysShowOutput: true,
    });
    expect(r.formatted).toContain("snapshot content");
    expect(r.formatted.startsWith("✓ snapshot")).toBe(true);
  });
});

describe("formatSilent — failure path", () => {
  it("emits ✗ header + full output", () => {
    const r = formatSilent({
      description: "tests",
      output: "FAIL: assertion failed\n  at foo.ts:42",
      exitCode: 1,
    });
    expect(r.succeeded).toBe(false);
    expect(r.formatted).toContain("✗ tests");
    expect(r.formatted).toContain("FAIL: assertion failed");
  });

  it("preserves stack traces inside output", () => {
    const r = formatSilent({
      description: "compile",
      output: "Error: x\n    at runMe (file.ts:10)\n    at main (file.ts:20)",
      exitCode: 2,
    });
    expect(r.formatted).toContain("at runMe");
    expect(r.formatted).toContain("at main");
  });
});

describe("formatSilent — truncation on failure", () => {
  it("truncates very long output and notes the drop", () => {
    const long = "FAIL\n" + "x".repeat(10_000);
    const r = formatSilent({
      description: "tests",
      output: long,
      exitCode: 1,
      maxFailureOutputChars: 100,
    });
    expect(r.truncated).toBe(true);
    expect(r.formatted).toContain("truncated");
    expect(r.formatted.length).toBeLessThan(long.length);
  });

  it("does NOT truncate short failure output", () => {
    const r = formatSilent({
      description: "tests",
      output: "short\nfailure\noutput",
      exitCode: 1,
      maxFailureOutputChars: 1000,
    });
    expect(r.truncated).toBe(false);
    expect(r.formatted).toContain("short");
  });
});

describe("formatSilent — bytesSaved accounting", () => {
  it("reports bytes saved on success", () => {
    const r = formatSilent({
      description: "x",
      output: "a".repeat(500),
      exitCode: 0,
    });
    expect(r.bytesSaved).toBe(500);
  });

  it("reports zero saved on a non-truncated failure", () => {
    const r = formatSilent({
      description: "x",
      output: "short fail",
      exitCode: 1,
      maxFailureOutputChars: 1000,
    });
    expect(r.bytesSaved).toBe(0);
  });
});

describe("formatSilent — empty output", () => {
  it("succeeds with no output and ✓ header", () => {
    const r = formatSilent({ description: "noop", output: "", exitCode: 0 });
    expect(r.formatted).toBe("✓ noop");
    expect(r.bytesSaved).toBe(0);
  });
});

describe("formatSilentPipeline", () => {
  it("collapses all-success pipeline to ✓ lines", () => {
    const r = formatSilentPipeline([
      { description: "typecheck", output: "ok", exitCode: 0 },
      { description: "lint", output: "ok", exitCode: 0 },
      { description: "test", output: "ok", exitCode: 0 },
    ]);
    expect(r.succeeded).toBe(true);
    expect(r.formatted.split("\n").length).toBe(3);
    expect(r.formatted).toContain("✓ typecheck");
    expect(r.formatted).toContain("✓ lint");
    expect(r.formatted).toContain("✓ test");
  });

  it("includes full output ONLY for the failing step", () => {
    const r = formatSilentPipeline([
      { description: "typecheck", output: "yes", exitCode: 0 },
      { description: "lint", output: "ERR: bad style\nat foo.ts:5", exitCode: 1 },
      { description: "test", output: "yes", exitCode: 0 },
    ]);
    expect(r.succeeded).toBe(false);
    expect(r.formatted).toContain("✓ typecheck");
    expect(r.formatted).toContain("✗ lint");
    expect(r.formatted).toContain("ERR: bad style");
    expect(r.formatted).toContain("✓ test");
  });

  it("sums bytesSaved across the pipeline", () => {
    const r = formatSilentPipeline([
      { description: "a", output: "x".repeat(500), exitCode: 0 },
      { description: "b", output: "y".repeat(300), exitCode: 0 },
    ]);
    expect(r.bytesSaved).toBe(800);
  });
});

describe("resultToPayload", () => {
  it("emits stable shape on success", () => {
    const r = formatSilent({ description: "x", output: "ok", exitCode: 0 });
    const p = resultToPayload(r);
    expect(p.kind).toBe("silent_tool_format.result_recorded");
    expect(p.succeeded).toBe(true);
  });
});

describe("HumanLayer scenario — test suite with one failure", () => {
  it("preserves the failing test's output, drops the rest", () => {
    const result = formatSilentPipeline([
      { description: "typecheck", output: "✓ all clean".repeat(200), exitCode: 0 },
      {
        description: "unit tests",
        output: "FAIL: orderRouting.test.ts > rejects on no-liquidity\n  expected status 'rejected', got 'pending'",
        exitCode: 1,
      },
      { description: "e2e", output: "skipped".repeat(50), exitCode: 0 },
    ]);
    expect(result.formatted).toContain("✗ unit tests");
    expect(result.formatted).toContain("orderRouting.test.ts");
    // The typecheck noise should NOT be present
    expect(result.formatted).not.toContain("✓ all clean");
  });
});
