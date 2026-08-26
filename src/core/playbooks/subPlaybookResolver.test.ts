import { describe, it, expect } from "bun:test";
import type { Playbook, SubPlaybookReference } from "./types.ts";
import { applySubPlaybookParameters, resolveSubPlaybooks } from "./subPlaybookResolver.ts";

function pb(id: string, subs: SubPlaybookReference[] = []): Playbook {
  return {
    id,
    name: id,
    version: "0.1.0",
    author: "test",
    description: `${id} description`,
    tier: 1,
    riskLevel: "low",
    markets: ["crypto"],
    timeframes: ["1h"],
    trigger: {
      description: `${id} trigger`,
      conditions: [],
      agentSubscription: "scanner",
    },
    analysis: {
      description: `${id} analysis`,
      checks: [],
    } as unknown as Playbook["analysis"],
    execution: {
      entryType: "market",
      entryDescription: `${id} entry`,
      stopLoss: { description: "1%", type: "fixed_percent", percentValue: 1 },
      takeProfit: { description: "2:1", riskRewardRatio: 2 },
      positionSizing: { description: "1% risk", riskPercent: 1 },
    },
    management: { description: "manage", rules: [] } as Playbook["management"],
    review: { description: "review", checks: [] } as unknown as Playbook["review"],
    tags: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    source: "builtin",
    subPlaybooks: subs,
  };
}

function lookup(playbooks: Playbook[]) {
  const map = new Map(playbooks.map((p) => [p.id, p]));
  return (id: string) => map.get(id);
}

describe("resolveSubPlaybooks", () => {
  it("returns empty resolved + no errors when there are no subs", () => {
    const r = resolveSubPlaybooks(pb("root"), lookup([pb("root")]));
    expect(r.resolved).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it("resolves one level of sub-playbooks in order", () => {
    const child1 = pb("child1");
    const child2 = pb("child2");
    const root = pb("root", [
      { playbookId: "child1" },
      { playbookId: "child2", parameters: { rsi: 30 } },
    ]);
    const r = resolveSubPlaybooks(root, lookup([root, child1, child2]));
    expect(r.errors).toEqual([]);
    expect(r.resolved.length).toBe(2);
    expect(r.resolved[0]?.playbook.id).toBe("child1");
    expect(r.resolved[1]?.playbook.id).toBe("child2");
    expect(r.resolved[1]?.parameters).toEqual({ rsi: 30 });
  });

  it("resolves nested sub-playbooks depth-first", () => {
    const grandchild = pb("grandchild");
    const child = pb("child", [{ playbookId: "grandchild" }]);
    const root = pb("root", [{ playbookId: "child" }]);
    const r = resolveSubPlaybooks(root, lookup([root, child, grandchild]));
    expect(r.errors).toEqual([]);
    const ids = r.resolved.map((rs) => rs.playbook.id);
    expect(ids).toEqual(["child", "grandchild"]);
  });

  it("detects direct cycles", () => {
    const root = pb("root", [{ playbookId: "root" }]);
    const r = resolveSubPlaybooks(root, lookup([root]));
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]?.kind).toBe("cycle_detected");
  });

  it("detects indirect cycles (A → B → A)", () => {
    const a = pb("a", [{ playbookId: "b" }]);
    const b = pb("b", [{ playbookId: "a" }]);
    const r = resolveSubPlaybooks(a, lookup([a, b]));
    const cycleErrors = r.errors.filter((e) => e.kind === "cycle_detected");
    expect(cycleErrors.length).toBeGreaterThan(0);
  });

  it("reports missing references without halting", () => {
    const root = pb("root", [
      { playbookId: "ghost" },
      { playbookId: "real" },
    ]);
    const real = pb("real");
    const r = resolveSubPlaybooks(root, lookup([root, real]));
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]?.kind).toBe("missing_reference");
    // Resolution continues — `real` still resolves.
    expect(r.resolved.length).toBe(1);
    expect(r.resolved[0]?.playbook.id).toBe("real");
  });

  it("enforces max-depth", () => {
    // Build a chain a → b → c → d → e (depth 4 from root)
    const e = pb("e");
    const d = pb("d", [{ playbookId: "e" }]);
    const c = pb("c", [{ playbookId: "d" }]);
    const b = pb("b", [{ playbookId: "c" }]);
    const a = pb("a", [{ playbookId: "b" }]);
    const r = resolveSubPlaybooks(a, lookup([a, b, c, d, e]), { maxDepth: 2 });
    expect(r.errors.some((er) => er.kind === "max_depth_exceeded")).toBe(true);
  });

  it("uses the alias when provided", () => {
    const child = pb("rsi-entry");
    const root = pb("root", [
      { playbookId: "rsi-entry", alias: "fast-entry", parameters: { rsi: 25 } },
      { playbookId: "rsi-entry", alias: "slow-entry", parameters: { rsi: 35 } },
    ]);
    const r = resolveSubPlaybooks(root, lookup([root, child]));
    expect(r.resolved.length).toBe(2);
    expect(r.resolved[0]?.alias).toBe("fast-entry");
    expect(r.resolved[1]?.alias).toBe("slow-entry");
  });
});

describe("applySubPlaybookParameters", () => {
  it("returns the playbook unchanged when no params provided", () => {
    const p = pb("test");
    expect(applySubPlaybookParameters(p, {})).toBe(p);
  });

  it("substitutes {{key}} placeholders in description fields", () => {
    const p = pb("rsi-entry");
    p.description = "Enter when RSI < {{rsiThreshold}}";
    p.trigger.description = "RSI crosses {{rsiThreshold}} from below";
    p.execution.entryDescription = "Market buy at {{rsiThreshold}} touch";
    const out = applySubPlaybookParameters(p, { rsiThreshold: 30 });
    expect(out.description).toBe("Enter when RSI < 30");
    expect(out.trigger.description).toBe("RSI crosses 30 from below");
    expect(out.execution.entryDescription).toBe("Market buy at 30 touch");
  });

  it("leaves unknown placeholders untouched (visible failure)", () => {
    const p = pb("test");
    p.description = "Use {{horizon}} hours and {{unknown}}";
    const out = applySubPlaybookParameters(p, { horizon: 96 });
    expect(out.description).toBe("Use 96 hours and {{unknown}}");
  });

  it("substitutes inside nested execution rules", () => {
    const p = pb("test");
    p.execution.stopLoss.description = "Stop at {{stopPercent}}% below entry";
    p.execution.takeProfit.description = "Target {{tpRatio}}:1 R/R";
    const out = applySubPlaybookParameters(p, { stopPercent: 1.5, tpRatio: 2.5 });
    expect(out.execution.stopLoss.description).toBe("Stop at 1.5% below entry");
    expect(out.execution.takeProfit.description).toBe("Target 2.5:1 R/R");
  });

  it("returns a new object — does not mutate the input", () => {
    const p = pb("test");
    p.description = "{{x}}";
    const out = applySubPlaybookParameters(p, { x: 42 });
    expect(p.description).toBe("{{x}}"); // original unchanged
    expect(out.description).toBe("42");
  });
});
