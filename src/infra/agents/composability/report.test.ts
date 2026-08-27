import { describe, it, expect } from "bun:test";
import { captureComposabilityReport, formatComposabilityReport } from "./report.ts";

describe("captureComposabilityReport — shape", () => {
  it("returns ≥ 10 pluggability axes", () => {
    const report = captureComposabilityReport({
      countSkills: () => 35,
      countMcpServers: () => 66,
    });
    expect(report.totalAxes).toBeGreaterThanOrEqual(10);
    expect(report.slots.length).toBe(report.totalAxes);
  });

  it("each slot has required fields", () => {
    const report = captureComposabilityReport({
      countSkills: () => 35,
      countMcpServers: () => 66,
    });
    for (const slot of report.slots) {
      expect(slot.axis).toBeTruthy();
      expect(slot.axisLabel).toBeTruthy();
      expect(typeof slot.activeCount).toBe("number");
      expect(typeof slot.availableCount).toBe("number");
      expect(typeof slot.pluggable).toBe("boolean");
      expect(slot.description.length).toBeGreaterThan(0);
    }
  });

  it("totalActive and totalAvailable match slot sums", () => {
    const report = captureComposabilityReport({
      countSkills: () => 35,
      countMcpServers: () => 66,
    });
    const sumActive = report.slots.reduce((s, slot) => s + slot.activeCount, 0);
    const sumAvail = report.slots.reduce((s, slot) => s + slot.availableCount, 0);
    expect(report.totalActive).toBe(sumActive);
    expect(report.totalAvailable).toBe(sumAvail);
  });
});

describe("captureComposabilityReport — known axes", () => {
  it("includes the load-bearing axes Variant's essay names", () => {
    const report = captureComposabilityReport({
      countSkills: () => 35,
      countMcpServers: () => 66,
    });
    const axes = new Set(report.slots.map((s) => s.axis));
    // Variant essay names: harness, memory, models, routers, skills, MCP
    // Gordon adds: exchanges, brokers, peers, strategy recipes,
    // risk dimensions, alpha diagnostics, audit layers
    expect(axes.has("llm_provider")).toBe(true); // models
    expect(axes.has("skills")).toBe(true);
    expect(axes.has("mcp_server")).toBe(true);
    expect(axes.has("peer_agent")).toBe(true);
    expect(axes.has("exchange")).toBe(true);
    expect(axes.has("risk_dimension")).toBe(true);
    expect(axes.has("audit_layer")).toBe(true);
  });

  it("counts skills from injected probe", () => {
    const report = captureComposabilityReport({
      countSkills: () => 42,
      countMcpServers: () => 0,
    });
    const skillsSlot = report.slots.find((s) => s.axis === "skills")!;
    expect(skillsSlot.activeCount).toBe(42);
    expect(skillsSlot.availableCount).toBe(42);
  });

  it("counts MCP servers from injected probe", () => {
    const report = captureComposabilityReport({
      countSkills: () => 0,
      countMcpServers: () => 100,
    });
    const mcpSlot = report.slots.find((s) => s.axis === "mcp_server")!;
    expect(mcpSlot.availableCount).toBe(100);
  });
});

describe("captureComposabilityReport — pluggability flags", () => {
  it("all skill-derived + alpha + risk axes are pluggable", () => {
    const report = captureComposabilityReport({
      countSkills: () => 0,
      countMcpServers: () => 0,
    });
    const pluggable = report.slots.filter((s) => s.pluggable);
    const nonPluggable = report.slots.filter((s) => !s.pluggable);
    // Audit layers are non-pluggable (operator can't disable trade ledger);
    // everything else is pluggable
    expect(nonPluggable.length).toBe(1);
    expect(nonPluggable[0]!.axis).toBe("audit_layer");
    expect(pluggable.length).toBeGreaterThanOrEqual(9);
  });
});

describe("captureComposabilityReport — venue MEV dimension included", () => {
  it("includes Venue MEV Exposure in risk dimension sample", () => {
    const report = captureComposabilityReport({
      countSkills: () => 0,
      countMcpServers: () => 0,
    });
    const riskSlot = report.slots.find((s) => s.axis === "risk_dimension")!;
    expect(riskSlot.sample).toContain("Venue MEV Exposure");
    expect(riskSlot.activeCount).toBe(13);
  });
});

describe("captureComposabilityReport — summary text", () => {
  it("mentions axes + active + available counts", () => {
    const report = captureComposabilityReport({
      countSkills: () => 35,
      countMcpServers: () => 66,
    });
    expect(report.summary).toContain("pluggability axes");
    expect(report.summary).toContain("active");
    expect(report.summary).toContain("available");
  });
});

describe("formatComposabilityReport", () => {
  it("renders headers + per-slot lines", () => {
    const report = captureComposabilityReport({
      countSkills: () => 35,
      countMcpServers: () => 66,
    });
    const text = formatComposabilityReport(report);
    expect(text).toContain("Gordon Composability Report");
    expect(text).toContain("pluggability axes");
    expect(text).toContain("Sample:");
  });

  it("marks pluggable axes with ✓ and non-pluggable with ○", () => {
    const report = captureComposabilityReport({
      countSkills: () => 0,
      countMcpServers: () => 0,
    });
    const text = formatComposabilityReport(report);
    expect(text).toContain("✓");
    expect(text).toContain("○");
  });

  it("truncates sample lists longer than 8 entries with '+N more'", () => {
    const report = captureComposabilityReport({
      countSkills: () => 0,
      countMcpServers: () => 0,
    });
    const text = formatComposabilityReport(report);
    // The peer-agent slot has 6 entries, no truncation
    // The risk-dimension slot has 13 entries, should truncate
    expect(text).toContain("+5 more"); // 13 - 8 = 5
  });
});
