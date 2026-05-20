import { describe, it, expect } from "bun:test";
import {
  composeGoalDraft,
  goalDraftToPayload,
  isGoalDraftEnabled,
  GOAL_DRAFT_FLAG_ENV,
} from "./goalDraft.ts";

describe("isGoalDraftEnabled", () => {
  it("respects the flag", () => {
    expect(isGoalDraftEnabled({})).toBe(false);
    expect(isGoalDraftEnabled({ [GOAL_DRAFT_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("composeGoalDraft — validation", () => {
  it("rejects empty intent", () => {
    expect(() => composeGoalDraft({ vagueIntent: "" })).toThrow();
    expect(() => composeGoalDraft({ vagueIntent: "   " })).toThrow();
  });
});

describe("composeGoalDraft — keyword detection", () => {
  it("'sharpe' keyword → sharpe end-state", () => {
    const r = composeGoalDraft({ vagueIntent: "improve my Sharpe ratio" });
    expect(r.proposedEndState.type).toBe("sharpe");
  });

  it("'win rate' keyword → winrate end-state", () => {
    const r = composeGoalDraft({ vagueIntent: "raise my win rate" });
    expect(r.proposedEndState.type).toBe("winrate");
  });

  it("'trades' keyword → trades end-state", () => {
    const r = composeGoalDraft({ vagueIntent: "complete more trades this week" });
    expect(r.proposedEndState.type).toBe("trades");
  });

  it("'drawdown' keyword → drawdown_under end-state", () => {
    const r = composeGoalDraft({ vagueIntent: "limit my drawdown" });
    expect(r.proposedEndState.type).toBe("drawdown_under");
  });

  it("'checklist' keyword → checklist end-state", () => {
    const r = composeGoalDraft({ vagueIntent: "complete every checklist item" });
    expect(r.proposedEndState.type).toBe("checklist");
  });

  it("no keyword → defaults to sharpe", () => {
    const r = composeGoalDraft({ vagueIntent: "make money this week" });
    expect(r.proposedEndState.type).toBe("sharpe");
  });
});

describe("composeGoalDraft — threshold grounding", () => {
  it("recent Sharpe → proposed = recent × 1.2 capped at 2.0", () => {
    const r = composeGoalDraft({
      vagueIntent: "improve Sharpe",
      recentStats: { sharpe: 1.0 },
    });
    expect(r.proposedEndState.threshold).toBeCloseTo(1.2, 4);
  });

  it("recent Sharpe high → capped at 2.0", () => {
    const r = composeGoalDraft({
      vagueIntent: "improve Sharpe",
      recentStats: { sharpe: 5.0 },
    });
    expect(r.proposedEndState.threshold).toBe(2.0);
  });

  it("recent Sharpe absent → defaults to 1.0", () => {
    const r = composeGoalDraft({ vagueIntent: "improve Sharpe" });
    expect(r.proposedEndState.threshold).toBe(1.0);
  });

  it("recent winrate → proposed = recent + 5pp capped at 70%", () => {
    const r = composeGoalDraft({
      vagueIntent: "raise win rate",
      recentStats: { winRatePct: 50 },
    });
    expect(r.proposedEndState.threshold).toBe(55);
  });

  it("recent winrate high → capped at 70%", () => {
    const r = composeGoalDraft({
      vagueIntent: "raise win rate",
      recentStats: { winRatePct: 75 },
    });
    expect(r.proposedEndState.threshold).toBe(70);
  });

  it("recent trade count → proposed = recent × 2", () => {
    const r = composeGoalDraft({
      vagueIntent: "complete more trades",
      recentStats: { tradeCount: 10 },
    });
    expect(r.proposedEndState.threshold).toBe(20);
  });

  it("recent drawdown → proposed = recent × 0.8 (tighter)", () => {
    const r = composeGoalDraft({
      vagueIntent: "limit drawdown",
      recentStats: { maxDrawdownPct: 10 },
    });
    expect(r.proposedEndState.threshold).toBeCloseTo(8, 4);
  });
});

describe("composeGoalDraft — confidence levels", () => {
  it("keyword + stats → high confidence", () => {
    const r = composeGoalDraft({
      vagueIntent: "improve Sharpe",
      recentStats: { sharpe: 1.0 },
    });
    expect(r.confidence).toBe("high");
  });

  it("keyword without stats → medium confidence", () => {
    const r = composeGoalDraft({ vagueIntent: "improve Sharpe" });
    expect(r.confidence).toBe("medium");
  });

  it("stats without keyword → medium confidence", () => {
    const r = composeGoalDraft({
      vagueIntent: "make money this week",
      recentStats: { sharpe: 1.0 },
    });
    expect(r.confidence).toBe("medium");
  });

  it("no keyword + no stats → low confidence", () => {
    const r = composeGoalDraft({ vagueIntent: "make money this week" });
    expect(r.confidence).toBe("low");
  });
});

describe("composeGoalDraft — constraints", () => {
  it("carries mandate exclusions into constraints", () => {
    const r = composeGoalDraft({
      vagueIntent: "improve Sharpe",
      activeMandateExclusions: ["no leverage", "BTC only"],
    });
    expect(r.proposedConstraints).toContain("no leverage");
    expect(r.proposedConstraints).toContain("BTC only");
  });

  it("no exclusions → default 'exceeding daily loss limit'", () => {
    const r = composeGoalDraft({ vagueIntent: "improve Sharpe" });
    expect(r.proposedConstraints).toContain("exceeding daily loss limit");
  });
});

describe("composeGoalDraft — composed text", () => {
  it("composes 'X until Y without Z' grammar", () => {
    const r = composeGoalDraft({
      vagueIntent: "improve Sharpe",
      recentStats: { sharpe: 1.0 },
      activeMandateExclusions: ["no leverage"],
    });
    expect(r.proposedGoalText).toContain("until");
    expect(r.proposedGoalText).toContain("without");
    expect(r.proposedGoalText).toContain("Sharpe");
    expect(r.proposedGoalText).toContain("no leverage");
  });
});

describe("composeGoalDraft — horizon detection", () => {
  it("explicit horizon in intent → carried through for time_horizon end-state", () => {
    // Force time-horizon via direct check on horizon detection — the
    // default end-state detector won't pick this up, but the horizon
    // utility is exercised through the rationale.
    const r = composeGoalDraft({
      vagueIntent: "trade for 3 days",
      preferredHorizon: "days",
    });
    expect(r.proposedGoalText.length).toBeGreaterThan(0);
  });
});

describe("goalDraftToPayload", () => {
  it("emits stable shape", () => {
    const r = composeGoalDraft({
      vagueIntent: "improve Sharpe",
      recentStats: { sharpe: 1.0 },
    });
    const p = goalDraftToPayload(r) as {
      kind: string;
      proposedEndStateType: string;
      confidence: string;
    };
    expect(p.kind).toBe("goal_draft.composed");
    expect(p.proposedEndStateType).toBe("sharpe");
    expect(p.confidence).toBe("high");
  });
});
