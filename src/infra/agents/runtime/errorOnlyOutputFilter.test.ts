import { describe, it, expect } from "bun:test";

import {
  filterOutput,
  filterOutputForAgent,
  resultToPayload,
  DEFAULT_ERROR_PATTERNS,
  type FilterRule,
} from "./errorOnlyOutputFilter.ts";

describe("DEFAULT_ERROR_PATTERNS", () => {
  it("includes both surface and suppress rules", () => {
    const actions = new Set(DEFAULT_ERROR_PATTERNS.map((r) => r.action));
    expect(actions.has("surface")).toBe(true);
    expect(actions.has("suppress")).toBe(true);
  });
});

describe("filterOutput — all-success input", () => {
  it("suppresses everything when no surface rule fires", () => {
    const input = ["✓ test 1 passed", "✓ test 2 passed", "3 passing", "OK"].join("\n");
    const r = filterOutput(input);
    expect(r.hasErrors).toBe(false);
    expect(r.surfaced.length).toBe(0);
    expect(r.suppressedCount).toBe(4);
  });

  it("compressionRatio is 0 on an all-suppress run", () => {
    const input = ["✓ A", "✓ B", "✓ C"].join("\n");
    const r = filterOutput(input);
    expect(r.compressionRatio).toBe(0);
  });
});

describe("filterOutput — surfaces error lines", () => {
  it("surfaces a line containing 'Error'", () => {
    const input = "Error: something broke";
    const r = filterOutput(input);
    expect(r.hasErrors).toBe(true);
    expect(r.surfaced).toContain("Error: something broke");
  });

  it("surfaces FAIL lines and stack frames", () => {
    const input = [
      "FAIL: assertion failed",
      "    at runTest (file.ts:10:5)",
      "    at main (file.ts:20:3)",
    ].join("\n");
    const r = filterOutput(input);
    expect(r.surfaced.length).toBe(3);
  });

  it("surfaces ✗ glyph lines", () => {
    const input = "✗ test 1 failed";
    const r = filterOutput(input);
    expect(r.hasErrors).toBe(true);
    expect(r.surfaced[0]).toContain("✗");
  });

  it("surfaces exception class names", () => {
    const input = "TypeError: cannot read property 'x' of undefined";
    const r = filterOutput(input);
    expect(r.hasErrors).toBe(true);
    expect(r.surfaced[0]).toContain("TypeError");
  });

  it("surfaces broker-reject keywords", () => {
    const input = "Order rejected: insufficient margin";
    const r = filterOutput(input);
    expect(r.hasErrors).toBe(true);
  });
});

describe("filterOutput — context windows", () => {
  it("includes contextBefore lines around a surfaced line", () => {
    const input = [
      "Step 1: connecting",
      "Step 2: authenticating",
      "Step 3: submitting order",
      "Error: order rejected",
      "Step 4: cleanup",
    ].join("\n");
    const r = filterOutput(input, { contextBefore: 2, contextAfter: 0 });
    expect(r.surfaced).toContain("Step 2: authenticating");
    expect(r.surfaced).toContain("Step 3: submitting order");
    expect(r.surfaced).toContain("Error: order rejected");
    expect(r.surfaced).not.toContain("Step 4: cleanup");
  });

  it("includes contextAfter lines", () => {
    const input = ["Error: x", "after 1", "after 2", "after 3"].join("\n");
    const r = filterOutput(input, { contextBefore: 0, contextAfter: 2 });
    expect(r.surfaced).toContain("after 1");
    expect(r.surfaced).toContain("after 2");
    expect(r.surfaced).not.toContain("after 3");
  });

  it("does not include context when contextBefore=0 and contextAfter=0", () => {
    const input = ["Step 1", "Error: x", "Step 3"].join("\n");
    const r = filterOutput(input, { contextBefore: 0, contextAfter: 0 });
    expect(r.surfaced).toEqual(["Error: x"]);
  });
});

describe("filterOutput — priority resolution", () => {
  it("higher priority rule wins when both match", () => {
    const input = "Error passed verification";
    // Both "Error" (surface, priority 100) and "passed" (suppress, priority 50) match.
    // Surface should win.
    const r = filterOutput(input);
    expect(r.surfaced.length).toBe(1);
  });

  it("respects custom rule priorities", () => {
    const rules: FilterRule[] = [
      { id: "win-suppress", pattern: /test/, action: "suppress", priority: 100 },
      { id: "lose-surface", pattern: /test/, action: "surface", priority: 50 },
    ];
    const r = filterOutput("this is a test", { rules });
    expect(r.surfaced.length).toBe(0);
  });
});

describe("filterOutput — defaultAction", () => {
  it("defaultAction='suppress' drops unmatched lines (default)", () => {
    const input = "regular log line with no match";
    const r = filterOutput(input);
    expect(r.surfaced.length).toBe(0);
  });

  it("defaultAction='surface' keeps unmatched lines", () => {
    const input = "regular log line with no match";
    const r = filterOutput(input, { defaultAction: "surface" });
    expect(r.surfaced.length).toBe(1);
  });
});

describe("filterOutput — maxLines cap", () => {
  it("caps surfaced lines to maxLines", () => {
    const errors = Array.from({ length: 50 }, (_, i) => `Error ${i}`);
    const r = filterOutput(errors.join("\n"), { contextBefore: 0, maxLines: 10 });
    expect(r.surfaced.length).toBe(10);
    expect(r.suppressedCount).toBe(40);
  });
});

describe("filterOutput — counting + ratios", () => {
  it("reports total lines correctly", () => {
    const input = ["a", "b", "c", "d", "e"].join("\n");
    expect(filterOutput(input).totalLines).toBe(5);
  });

  it("hasErrors=true even when only one error is surfaced", () => {
    const input = ["✓ pass 1", "✓ pass 2", "FAIL"].join("\n");
    expect(filterOutput(input).hasErrors).toBe(true);
  });

  it("hasErrors=false when defaultAction='surface' but no surface rule fires", () => {
    const r = filterOutput("just text", { defaultAction: "surface" });
    expect(r.hasErrors).toBe(false);
  });
});

describe("filterOutput — empty input", () => {
  it("returns zero counts for empty string", () => {
    const r = filterOutput("");
    // Empty string still split() to [""] which is 1 line
    expect(r.totalLines).toBe(1);
    expect(r.surfaced.length).toBe(0);
  });
});

describe("filterOutput — CRLF line endings", () => {
  it("splits on CRLF as well as LF", () => {
    const input = "Error: x\r\nOK\r\nFAIL";
    const r = filterOutput(input);
    expect(r.totalLines).toBe(3);
    expect(r.hasErrors).toBe(true);
  });
});

describe("filterOutput — custom rules", () => {
  it("uses caller-provided rules", () => {
    const rules: FilterRule[] = [
      {
        id: "gordon-trade-blocked",
        pattern: /\bTRADE_BLOCKED\b/,
        action: "surface",
        priority: 200,
      },
    ];
    const r = filterOutput(
      ["normal log", "TRADE_BLOCKED: deny-list match", "more logs"].join("\n"),
      { rules },
    );
    expect(r.hasErrors).toBe(true);
    expect(r.surfaced.some((l) => l.includes("TRADE_BLOCKED"))).toBe(true);
  });
});

describe("filterOutputForAgent", () => {
  it("returns the raw filtered output when nothing was suppressed", () => {
    const out = filterOutputForAgent("Error: x", { contextBefore: 0 });
    expect(out).toBe("Error: x");
  });

  it("collapses all-success runs to a single OK line", () => {
    const input = ["✓ test 1", "✓ test 2", "5 passing"].join("\n");
    const out = filterOutputForAgent(input);
    expect(out).toContain("no errors detected");
  });

  it("appends a suppressed-count suffix when errors AND suppressed lines exist", () => {
    const input = ["✓ pass", "✓ pass", "FAIL: oh no", "✓ pass"].join("\n");
    const out = filterOutputForAgent(input, { contextBefore: 0 });
    expect(out).toContain("FAIL: oh no");
    expect(out).toContain("suppressed");
  });
});

describe("resultToPayload", () => {
  it("emits stable shape", () => {
    const r = filterOutput("Error: x");
    const p = resultToPayload(r);
    expect(p.kind).toBe("error_only_filter.result_recorded");
    expect(p.hasErrors).toBe(true);
  });
});

describe("HumanLayer scenario — 4000 lines of passing tests + one failure", () => {
  it("collapses the noise and surfaces the failure with context", () => {
    const passLines = Array.from({ length: 4000 }, (_, i) => `✓ test_${i} passed`);
    const lines = [
      ...passLines.slice(0, 2000),
      "Running suite B",
      "  setting up",
      "FAIL: integration test broke",
      "    at brokerAdapter.ts:42",
      ...passLines.slice(2000),
    ];
    const r = filterOutput(lines.join("\n"), { contextBefore: 2, contextAfter: 0 });
    expect(r.hasErrors).toBe(true);
    expect(r.surfaced.some((l) => l.includes("FAIL: integration test broke"))).toBe(true);
    expect(r.surfaced.length).toBeLessThan(20); // huge compression
    expect(r.compressionRatio).toBeLessThan(0.01);
  });
});
