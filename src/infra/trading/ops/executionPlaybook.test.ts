import { describe, it, expect, beforeEach } from "bun:test";

import {
  listPlaybooks,
  getPlaybook,
  registerPlaybook,
  attachExecution,
  formatPlaybook,
  planToPayload,
  resetRegistryForTesting,
  BUILTIN_PLAYBOOKS,
  PlaybookNotFoundError,
  type ExecutionPlaybook,
} from "./executionPlaybook.ts";

beforeEach(() => {
  resetRegistryForTesting();
});

describe("BUILTIN_PLAYBOOKS — invariants", () => {
  it("includes single-shot, scaled-thirds, breakout-confirm, range-extremity-fade, scalp-single", () => {
    const ids = BUILTIN_PLAYBOOKS.map((p) => p.id);
    expect(ids).toContain("single-shot");
    expect(ids).toContain("scaled-thirds");
    expect(ids).toContain("breakout-confirm");
    expect(ids).toContain("range-extremity-fade");
    expect(ids).toContain("scalp-single");
  });

  it("every playbook's entry fractions sum to 1.0 (within 0.01)", () => {
    for (const p of BUILTIN_PLAYBOOKS) {
      const sum = p.entry.reduce((s, c) => s + c.sizeFraction, 0);
      expect(sum).toBeGreaterThan(0.99);
      expect(sum).toBeLessThan(1.01);
    }
  });

  it("every playbook with exits has fractions summing to 1.0", () => {
    for (const p of BUILTIN_PLAYBOOKS) {
      if (p.exits.length === 0) continue;
      const sum = p.exits.reduce((s, c) => s + c.sizeFraction, 0);
      expect(sum).toBeGreaterThan(0.99);
      expect(sum).toBeLessThan(1.01);
    }
  });
});

describe("listPlaybooks / getPlaybook", () => {
  it("returns all built-ins after reset", () => {
    expect(listPlaybooks().length).toBe(BUILTIN_PLAYBOOKS.length);
  });

  it("getPlaybook returns the right one by id", () => {
    expect(getPlaybook("single-shot")?.name).toBe("Single Shot");
  });

  it("getPlaybook returns null for unknown id", () => {
    expect(getPlaybook("ghost")).toBeNull();
  });
});

describe("registerPlaybook — validation", () => {
  it("rejects when entry fractions don't sum to 1", () => {
    const bad: ExecutionPlaybook = {
      id: "bad",
      name: "Bad",
      description: "x",
      compatibility: ["any"],
      entry: [{ sizeFraction: 0.3 }, { sizeFraction: 0.3 }],
      exits: [{ sizeFraction: 1.0 }],
      stops: { initialStopAtR: 1 },
    };
    expect(() => registerPlaybook(bad)).toThrow();
  });

  it("rejects when exit fractions don't sum to 1 (unless empty)", () => {
    const bad: ExecutionPlaybook = {
      id: "bad",
      name: "Bad",
      description: "x",
      compatibility: ["any"],
      entry: [{ sizeFraction: 1.0 }],
      exits: [{ sizeFraction: 0.5 }],
      stops: { initialStopAtR: 1 },
    };
    expect(() => registerPlaybook(bad)).toThrow();
  });

  it("accepts custom playbook with valid fractions", () => {
    const ok: ExecutionPlaybook = {
      id: "custom-half-and-half",
      name: "Half and Half",
      description: "x",
      compatibility: ["any"],
      entry: [{ sizeFraction: 0.5 }, { sizeFraction: 0.5 }],
      exits: [{ sizeFraction: 1.0 }],
      stops: { initialStopAtR: 1 },
    };
    registerPlaybook(ok);
    expect(getPlaybook("custom-half-and-half")?.name).toBe("Half and Half");
  });

  it("allows empty exits (single exit at full target)", () => {
    const ok: ExecutionPlaybook = {
      id: "no-exit-ladder",
      name: "No Ladder",
      description: "x",
      compatibility: ["any"],
      entry: [{ sizeFraction: 1.0 }],
      exits: [],
      stops: { initialStopAtR: 1 },
    };
    expect(() => registerPlaybook(ok)).not.toThrow();
  });
});

describe("attachExecution — error handling", () => {
  it("throws PlaybookNotFoundError for unknown id", () => {
    expect(() =>
      attachExecution({
        planId: "p1",
        playbookId: "ghost",
        entryPrice: 100,
        direction: "long",
      }),
    ).toThrow(PlaybookNotFoundError);
  });
});

describe("attachExecution — single-shot resolution", () => {
  it("resolves entry at entryPrice when no offset", () => {
    const plan = attachExecution({
      planId: "p1",
      playbookId: "single-shot",
      entryPrice: 100,
      direction: "long",
    });
    expect(plan.scheduledEntries.length).toBe(1);
    expect(plan.scheduledEntries[0]!.resolvedPrice).toBe(100);
  });
});

describe("attachExecution — scaled-thirds with ATR", () => {
  it("resolves offset entries using ATR (long)", () => {
    const plan = attachExecution({
      planId: "p1",
      playbookId: "scaled-thirds",
      entryPrice: 100,
      atr: 2,
      direction: "long",
    });
    expect(plan.scheduledEntries.length).toBe(3);
    expect(plan.scheduledEntries[0]!.resolvedPrice).toBe(100); // at entry
    expect(plan.scheduledEntries[1]!.resolvedPrice).toBe(99); // -0.5 ATR for long
    expect(plan.scheduledEntries[2]!.resolvedPrice).toBe(98); // -1.0 ATR
  });

  it("flips offset direction for shorts", () => {
    const plan = attachExecution({
      planId: "p1",
      playbookId: "scaled-thirds",
      entryPrice: 100,
      atr: 2,
      direction: "short",
    });
    // short: stop above entry, pullbacks fade UP (offsets multiplied by -1)
    expect(plan.scheduledEntries[1]!.resolvedPrice).toBe(101);
    expect(plan.scheduledEntries[2]!.resolvedPrice).toBe(102);
  });
});

describe("attachExecution — R-multiple exits", () => {
  it("resolves R-multiple exits from entry + stop (long)", () => {
    // entry 100, stop 95 → R distance 5
    const plan = attachExecution({
      planId: "p1",
      playbookId: "scaled-thirds",
      entryPrice: 100,
      stopPrice: 95,
      direction: "long",
    });
    // exits at +1R, +2R → 105, 110
    expect(plan.scheduledExits[0]!.resolvedPrice).toBe(105);
    expect(plan.scheduledExits[1]!.resolvedPrice).toBe(110);
  });

  it("resolves R-multiple exits for shorts in the right direction", () => {
    // short: entry 100, stop 105 → R distance 5; exits BELOW entry
    const plan = attachExecution({
      planId: "p1",
      playbookId: "scaled-thirds",
      entryPrice: 100,
      stopPrice: 105,
      direction: "short",
    });
    expect(plan.scheduledExits[0]!.resolvedPrice).toBe(95); // -1R
    expect(plan.scheduledExits[1]!.resolvedPrice).toBe(90); // -2R
  });

  it("leaves exit price undefined when no stop given", () => {
    const plan = attachExecution({
      planId: "p1",
      playbookId: "scaled-thirds",
      entryPrice: 100,
      direction: "long",
    });
    expect(plan.scheduledExits[0]!.resolvedPrice).toBeUndefined();
  });
});

describe("attachExecution — output shape", () => {
  it("includes planId, playbookId, createdAt", () => {
    const plan = attachExecution({
      planId: "p1",
      playbookId: "single-shot",
      entryPrice: 100,
      direction: "long",
      now: "2026-05-13T10:00:00Z",
    });
    expect(plan.planId).toBe("p1");
    expect(plan.playbookId).toBe("single-shot");
    expect(plan.createdAt).toBe("2026-05-13T10:00:00Z");
  });
});

describe("formatPlaybook", () => {
  it("includes name, description, compatibility, entries, exits", () => {
    const out = formatPlaybook(getPlaybook("scaled-thirds")!);
    expect(out).toContain("Scaled Thirds");
    expect(out.toLowerCase()).toContain("compatibility");
    expect(out).toContain("Entry clips");
    expect(out).toContain("Exit clips");
  });
});

describe("planToPayload", () => {
  it("emits stable shape", () => {
    const plan = attachExecution({
      planId: "p1",
      playbookId: "single-shot",
      entryPrice: 100,
      direction: "long",
    });
    const p = planToPayload(plan);
    expect(p.kind).toBe("execution_playbook.plan_recorded");
    expect(p.planId).toBe("p1");
    expect(p.playbookId).toBe("single-shot");
  });
});

describe("TraderMorin scenario — same execution playbook across two trading playbooks", () => {
  it("scaled-thirds works for both mean_reversion and trend_continuation", () => {
    const meanRev = attachExecution({
      planId: "p1",
      playbookId: "scaled-thirds",
      entryPrice: 100,
      atr: 1,
      stopPrice: 98,
      direction: "long",
    });
    const trendCont = attachExecution({
      planId: "p2",
      playbookId: "scaled-thirds",
      entryPrice: 50,
      atr: 0.5,
      stopPrice: 49,
      direction: "long",
    });
    // Same playbook, different setup contexts — both resolve cleanly
    expect(meanRev.scheduledEntries.length).toBe(3);
    expect(trendCont.scheduledEntries.length).toBe(3);
    expect(meanRev.scheduledExits[0]!.resolvedPrice).toBe(102); // +1R from entry 100, stop 98
    expect(trendCont.scheduledExits[0]!.resolvedPrice).toBe(51); // +1R from entry 50, stop 49
  });
});
