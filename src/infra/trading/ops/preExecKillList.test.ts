import { describe, it, expect } from "bun:test";

import {
  isPreExecKillListEnabled,
  runKillList,
  formatResult,
  resultToPayload,
  PRE_EXEC_KILL_LIST_FLAG_ENV,
  type KillListInput,
} from "./preExecKillList.ts";

const allClear: KillListInput = {
  bored: false,
  angry: false,
  rushing: false,
  movedStop: false,
  scaredMoney: false,
};

describe("isPreExecKillListEnabled", () => {
  it("respects the flag (default-on, explicit opt-out)", () => {
    expect(isPreExecKillListEnabled({})).toBe(true);
    expect(isPreExecKillListEnabled({ [PRE_EXEC_KILL_LIST_FLAG_ENV]: "1" })).toBe(true);
    expect(isPreExecKillListEnabled({ [PRE_EXEC_KILL_LIST_FLAG_ENV]: "true" })).toBe(true);
    expect(isPreExecKillListEnabled({ [PRE_EXEC_KILL_LIST_FLAG_ENV]: "0" })).toBe(false);
    expect(isPreExecKillListEnabled({ [PRE_EXEC_KILL_LIST_FLAG_ENV]: "false" })).toBe(false);
  });
});

describe("runKillList — passes when all clear", () => {
  it("returns pass with empty blockers", () => {
    const r = runKillList(allClear, "2026-05-17T10:00:00Z");
    expect(r.pass).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.reasons).toEqual([]);
    expect(r.evaluatedAt).toBe("2026-05-17T10:00:00Z");
  });
});

describe("runKillList — single-flag failures", () => {
  it("bored → blocker 'bored'", () => {
    const r = runKillList({ ...allClear, bored: true });
    expect(r.pass).toBe(false);
    expect(r.blockers).toEqual(["bored"]);
    expect(r.reasons[0]).toContain("entertainment");
  });

  it("angry → blocker 'angry'", () => {
    const r = runKillList({ ...allClear, angry: true });
    expect(r.blockers).toEqual(["angry"]);
    expect(r.reasons[0]).toContain("Revenge");
  });

  it("rushing → blocker 'rushing'", () => {
    const r = runKillList({ ...allClear, rushing: true });
    expect(r.blockers).toEqual(["rushing"]);
    expect(r.reasons[0]).toContain("FOMO");
  });

  it("movedStop → blocker 'moved_stop'", () => {
    const r = runKillList({ ...allClear, movedStop: true });
    expect(r.blockers).toEqual(["moved_stop"]);
    expect(r.reasons[0]).toContain("bargaining");
  });

  it("scaredMoney → blocker 'scared_money'", () => {
    const r = runKillList({ ...allClear, scaredMoney: true });
    expect(r.blockers).toEqual(["scared_money"]);
    expect(r.reasons[0]).toContain("hardship");
  });
});

describe("runKillList — multiple flags aggregate", () => {
  it("two flags produce two blockers in stable order", () => {
    const r = runKillList({ ...allClear, angry: true, rushing: true });
    expect(r.pass).toBe(false);
    expect(r.blockers).toEqual(["angry", "rushing"]);
    expect(r.reasons.length).toBe(2);
  });

  it("all five flags produce five blockers", () => {
    const r = runKillList({
      bored: true,
      angry: true,
      rushing: true,
      movedStop: true,
      scaredMoney: true,
    });
    expect(r.blockers.length).toBe(5);
    expect(r.blockers).toEqual(["bored", "angry", "rushing", "moved_stop", "scared_money"]);
  });
});

describe("formatResult + resultToPayload", () => {
  it("formats a single-line PASS", () => {
    expect(formatResult(runKillList(allClear))).toBe("Kill list: PASS");
  });

  it("formats BLOCK with bullet reasons", () => {
    const out = formatResult(runKillList({ ...allClear, bored: true, angry: true }));
    expect(out).toContain("Kill list: BLOCK (2 flag(s))");
    expect(out.split("\n").length).toBe(3);
  });

  it("payload includes blocker count + names", () => {
    const p = resultToPayload(runKillList({ ...allClear, scaredMoney: true })) as {
      pass: boolean;
      blockerCount: number;
      blockers: string[];
    };
    expect(p.pass).toBe(false);
    expect(p.blockerCount).toBe(1);
    expect(p.blockers).toEqual(["scared_money"]);
  });
});

describe("Wright Ch 16 Protocol 6 scenarios", () => {
  it("a single 'yes' is enough to abort, regardless of how strong the setup is", () => {
    expect(runKillList({ ...allClear, scaredMoney: true }).pass).toBe(false);
  });

  it("a tilted trader (angry + moved-stop) is blocked unambiguously", () => {
    const r = runKillList({ ...allClear, angry: true, movedStop: true });
    expect(r.pass).toBe(false);
    expect(r.blockers).toContain("angry");
    expect(r.blockers).toContain("moved_stop");
  });
});
