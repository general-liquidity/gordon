import { describe, it, expect } from "bun:test";

import { runInitProbes, formatProbeReport, probeReportToPayload, type Probe } from "./initProbe.ts";

function mkProbe(
  id: string,
  status: "pass" | "fail" | "skip",
  options: { fixInstruction?: string; family?: Probe["family"]; throws?: boolean } = {},
): Probe {
  return {
    id,
    description: `probe ${id}`,
    family: options.family ?? "other",
    async check() {
      if (options.throws) throw new Error("kaboom");
      return {
        status,
        message: `${id} ${status}`,
        fixInstruction: status === "fail" ? (options.fixInstruction ?? "fix me") : undefined,
      };
    },
  };
}

describe("runInitProbes — empty input", () => {
  it("returns ready=true with zero probes", async () => {
    const report = await runInitProbes([]);
    expect(report.totalCount).toBe(0);
    expect(report.ready).toBe(true);
  });
});

describe("runInitProbes — all pass", () => {
  it("reports ready=true and per-probe pass status", async () => {
    const report = await runInitProbes([mkProbe("a", "pass"), mkProbe("b", "pass")]);
    expect(report.ready).toBe(true);
    expect(report.passingCount).toBe(2);
    expect(report.failingCount).toBe(0);
    expect(report.blockingFixInstruction).toBeNull();
  });
});

describe("runInitProbes — failure aggregation", () => {
  it("reports ready=false on any failure", async () => {
    const report = await runInitProbes([
      mkProbe("a", "pass"),
      mkProbe("b", "fail", { fixInstruction: "restart broker" }),
    ]);
    expect(report.ready).toBe(false);
    expect(report.failingCount).toBe(1);
    expect(report.blockingFixInstruction).toContain("[b]");
    expect(report.blockingFixInstruction).toContain("restart broker");
  });

  it("aggregates fix instructions across multiple failing probes", async () => {
    const report = await runInitProbes([
      mkProbe("a", "fail", { fixInstruction: "check connectivity" }),
      mkProbe("b", "fail", { fixInstruction: "check risk classifier" }),
    ]);
    expect(report.blockingFixInstruction).toContain("[a]");
    expect(report.blockingFixInstruction).toContain("[b]");
  });
});

describe("runInitProbes — failFast", () => {
  it("stops at the first failure", async () => {
    const a = mkProbe("a", "fail");
    const b = mkProbe("b", "pass");
    const report = await runInitProbes([a, b], { failFast: true });
    expect(report.results.length).toBe(1);
    expect(report.results[0]!.id).toBe("a");
  });

  it("does not stop on pass when failFast is on", async () => {
    const report = await runInitProbes([mkProbe("a", "pass"), mkProbe("b", "pass")], {
      failFast: true,
    });
    expect(report.results.length).toBe(2);
  });
});

describe("runInitProbes — skip", () => {
  it("marks ids in skipIds as skipped", async () => {
    const report = await runInitProbes([mkProbe("a", "pass"), mkProbe("b", "pass")], {
      skipIds: ["b"],
    });
    expect(report.skippedCount).toBe(1);
    expect(report.results.find((r) => r.id === "b")!.status).toBe("skip");
  });

  it("skipped probes do not affect ready=true", async () => {
    const report = await runInitProbes([mkProbe("a", "pass"), mkProbe("b", "fail")], {
      skipIds: ["b"],
    });
    expect(report.ready).toBe(true);
  });
});

describe("runInitProbes — error capture", () => {
  it("catches thrown errors and reports them as failures", async () => {
    const report = await runInitProbes([mkProbe("a", "pass", { throws: true })]);
    expect(report.failingCount).toBe(1);
    const r = report.results[0]!;
    expect(r.status).toBe("fail");
    expect(r.error).toContain("kaboom");
    expect(r.fixInstruction).toContain("a");
  });
});

describe("runInitProbes — timing", () => {
  it("records durationMs per probe and total", async () => {
    const slow: Probe = {
      id: "slow",
      description: "slow probe",
      async check() {
        await new Promise((r) => setTimeout(r, 25));
        return { status: "pass", message: "ok" };
      },
    };
    const report = await runInitProbes([slow]);
    expect(report.results[0]!.durationMs).toBeGreaterThanOrEqual(20);
    expect(report.durationMs).toBeGreaterThanOrEqual(report.results[0]!.durationMs);
  });
});

describe("runInitProbes — family routing", () => {
  it("records the probe's family in results", async () => {
    const report = await runInitProbes([
      mkProbe("v", "pass", { family: "venue" }),
      mkProbe("r", "fail", { family: "risk" }),
    ]);
    expect(report.results[0]!.family).toBe("venue");
    expect(report.results[1]!.family).toBe("risk");
  });

  it("defaults family to 'other' when unspecified", async () => {
    const probe: Probe = {
      id: "x",
      description: "x",
      async check() {
        return { status: "pass", message: "ok" };
      },
    };
    const report = await runInitProbes([probe]);
    expect(report.results[0]!.family).toBe("other");
  });
});

describe("formatProbeReport", () => {
  it("prints summary line + per-probe results", async () => {
    const report = await runInitProbes([
      mkProbe("a", "pass", { family: "venue" }),
      mkProbe("b", "fail", { fixInstruction: "fix b", family: "risk" }),
    ]);
    const out = formatProbeReport(report);
    expect(out).toContain("1/2 pass");
    expect(out).toContain("✓");
    expect(out).toContain("✗");
    expect(out).toContain("fix b");
  });
});

describe("probeReportToPayload", () => {
  it("emits stable shape", async () => {
    const report = await runInitProbes([mkProbe("a", "pass")]);
    const p = probeReportToPayload(report);
    expect(p.kind).toBe("init_probe.report_recorded");
    expect(p.ready).toBe(true);
    expect(p.passing).toBe(1);
  });
});
