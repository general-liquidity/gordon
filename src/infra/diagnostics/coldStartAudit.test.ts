import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isColdStartAuditEnabled,
  runColdStartAudit,
  formatAuditReport,
  auditToPayload,
  GORDON_DEFAULT_QUESTIONS,
  COLD_START_FLAG_ENV,
  type Question,
} from "./coldStartAudit.ts";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-coldstart-test-"));
});

describe("isColdStartAuditEnabled", () => {
  it("respects the flag", () => {
    expect(isColdStartAuditEnabled({})).toBe(false);
    expect(isColdStartAuditEnabled({ [COLD_START_FLAG_ENV]: "1" })).toBe(true);
    expect(isColdStartAuditEnabled({ [COLD_START_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("GORDON_DEFAULT_QUESTIONS", () => {
  it("has five canonical questions", () => {
    expect(GORDON_DEFAULT_QUESTIONS.length).toBe(5);
    expect(GORDON_DEFAULT_QUESTIONS.map((q) => q.id)).toEqual([
      "what_does_it_do",
      "how_to_start",
      "venues_connected",
      "in_progress",
      "next_action",
    ]);
  });
});

describe("runColdStartAudit", () => {
  it("scores 100% when all sources hit", () => {
    const claudePath = join(tempDir, "CLAUDE.md");
    writeFileSync(claudePath, "Gordon is a trading agent\nstart with bun");
    const q: Question = {
      id: "what_does_it_do",
      text: "What does Gordon do?",
      sources: [{ path: claudePath, mustContain: /Gordon/ }],
    };
    const report = runColdStartAudit([q]);
    expect(report.visibility).toBe(1);
    expect(report.gaps).toEqual([]);
    expect(report.questions[0]!.verdict).toBe("answered");
  });

  it("returns 0% when no sources exist", () => {
    const q: Question = {
      id: "missing",
      text: "missing?",
      sources: [{ path: join(tempDir, "nope.md") }],
    };
    const report = runColdStartAudit([q]);
    expect(report.visibility).toBe(0);
    expect(report.questions[0]!.verdict).toBe("missing");
    expect(report.gaps).toEqual(["missing"]);
  });

  it("returns partial when file exists but pattern doesn't match", () => {
    const path = join(tempDir, "x.md");
    writeFileSync(path, "irrelevant content");
    const q: Question = {
      id: "x",
      text: "x?",
      sources: [{ path, mustContain: "Gordon" }],
    };
    const report = runColdStartAudit([q]);
    expect(report.questions[0]!.verdict).toBe("partial");
    expect(report.visibility).toBe(0);
    expect(report.gaps).toEqual(["x"]);
  });

  it("first-hit-wins across multiple sources", () => {
    const a = join(tempDir, "a.md");
    const b = join(tempDir, "b.md");
    writeFileSync(b, "answer here");
    const q: Question = {
      id: "y",
      text: "y?",
      sources: [{ path: a }, { path: b }],
    };
    const report = runColdStartAudit([q]);
    expect(report.questions[0]!.hitSource?.path).toBe(b);
    expect(report.questions[0]!.attempted.length).toBe(2);
  });

  it("treats existing directories as a hit without content check", () => {
    const subdir = join(tempDir, "src", "infra", "exchange");
    mkdirSync(subdir, { recursive: true });
    const q: Question = {
      id: "venues",
      text: "venues?",
      sources: [{ path: subdir }],
    };
    const report = runColdStartAudit([q]);
    expect(report.questions[0]!.verdict).toBe("answered");
  });

  it("computes visibility across multiple questions", () => {
    const present = join(tempDir, "present.md");
    writeFileSync(present, "x");
    const missing = join(tempDir, "missing.md");

    const report = runColdStartAudit([
      { id: "q1", text: "q1", sources: [{ path: present }] },
      { id: "q2", text: "q2", sources: [{ path: missing }] },
    ]);
    expect(report.visibility).toBe(0.5);
    expect(report.gaps).toEqual(["q2"]);
  });

  it("uses regex pattern correctly", () => {
    const path = join(tempDir, "r.md");
    writeFileSync(path, "Bun runtime");
    const report = runColdStartAudit([
      { id: "x", text: "x", sources: [{ path, mustContain: /bun/i }] },
    ]);
    expect(report.questions[0]!.verdict).toBe("answered");
  });

  it("uses string pattern correctly", () => {
    const path = join(tempDir, "s.md");
    writeFileSync(path, "needle in haystack");
    const report = runColdStartAudit([
      { id: "x", text: "x", sources: [{ path, mustContain: "needle" }] },
    ]);
    expect(report.questions[0]!.verdict).toBe("answered");
  });

  it("respects custom resolver", () => {
    writeFileSync(join(tempDir, "found.md"), "x");
    const report = runColdStartAudit(
      [{ id: "x", text: "x", sources: [{ path: "found.md" }] }],
      { resolver: (p) => join(tempDir, p) },
    );
    expect(report.questions[0]!.verdict).toBe("answered");
  });

  it("records all attempted sources", () => {
    const report = runColdStartAudit([
      {
        id: "x",
        text: "x",
        sources: [
          { path: join(tempDir, "a") },
          { path: join(tempDir, "b") },
          { path: join(tempDir, "c") },
        ],
      },
    ]);
    expect(report.questions[0]!.attempted.length).toBe(3);
  });

  it("returns 100% visibility for empty question set (vacuous truth)", () => {
    const report = runColdStartAudit([]);
    expect(report.visibility).toBe(1);
    expect(report.gaps).toEqual([]);
  });

  it("uses injected timestamp", () => {
    const report = runColdStartAudit([], { now: "2026-05-13T10:00:00.000Z" });
    expect(report.capturedAt).toBe("2026-05-13T10:00:00.000Z");
  });
});

describe("formatAuditReport", () => {
  it("includes visibility percentage and per-question verdicts", () => {
    const present = join(tempDir, "p.md");
    writeFileSync(present, "x");
    const report = runColdStartAudit([
      { id: "q1", text: "Does it work?", sources: [{ path: present, note: "ok" }] },
      { id: "q2", text: "What now?", sources: [{ path: join(tempDir, "missing.md") }] },
    ]);
    const out = formatAuditReport(report);
    expect(out).toContain("Visibility: 50%");
    expect(out).toContain("[OK]");
    expect(out).toContain("[MISSING]");
  });
});

describe("auditToPayload", () => {
  it("emits stable shape", () => {
    const report = runColdStartAudit([]);
    const p = auditToPayload(report);
    expect(p.kind).toBe("cold_start.audit_recorded");
    expect(p.visibility).toBe(1);
  });
});
