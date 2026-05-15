import { describe, it, expect } from "bun:test";

import {
  isRecitationCheckpointEnabled,
  initialRecitationState,
  shouldRecite,
  markRecited,
  buildRecitationBlock,
  recitationToPayload,
  RECITATION_CHECKPOINT_FLAG_ENV,
} from "./recitationCheckpoint.ts";

describe("isRecitationCheckpointEnabled", () => {
  it("respects the flag", () => {
    expect(isRecitationCheckpointEnabled({})).toBe(false);
    expect(isRecitationCheckpointEnabled({ [RECITATION_CHECKPOINT_FLAG_ENV]: "1" })).toBe(true);
    expect(isRecitationCheckpointEnabled({ [RECITATION_CHECKPOINT_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("initialRecitationState", () => {
  it("starts at zero", () => {
    expect(initialRecitationState()).toEqual({ lastRecitedTurn: 0, lastRecitedToolCalls: 0 });
  });
});

describe("shouldRecite — cadence by turns", () => {
  it("returns false within the cadence window", () => {
    const r = shouldRecite(
      { currentTurn: 5, currentToolCalls: 0, state: initialRecitationState() },
      { everyTurns: 8 },
    );
    expect(r.shouldRecite).toBe(false);
  });

  it("returns true at the turn threshold", () => {
    const r = shouldRecite(
      { currentTurn: 8, currentToolCalls: 0, state: initialRecitationState() },
      { everyTurns: 8 },
    );
    expect(r.shouldRecite).toBe(true);
    expect(r.reason).toContain("turns since");
  });

  it("returns true past the threshold", () => {
    const r = shouldRecite(
      { currentTurn: 12, currentToolCalls: 0, state: initialRecitationState() },
      { everyTurns: 8 },
    );
    expect(r.shouldRecite).toBe(true);
  });

  it("default cadence is 8 turns", () => {
    expect(
      shouldRecite({ currentTurn: 8, currentToolCalls: 0, state: initialRecitationState() })
        .shouldRecite,
    ).toBe(true);
  });
});

describe("shouldRecite — cadence by tool calls", () => {
  it("returns true at the tool-call threshold", () => {
    const r = shouldRecite(
      { currentTurn: 0, currentToolCalls: 20, state: initialRecitationState() },
      { everyToolCalls: 20, everyTurns: 9999 },
    );
    expect(r.shouldRecite).toBe(true);
    expect(r.reason).toContain("tool calls since");
  });

  it("default cadence is 20 tool calls", () => {
    expect(
      shouldRecite({
        currentTurn: 0,
        currentToolCalls: 20,
        state: initialRecitationState(),
      }).shouldRecite,
    ).toBe(true);
  });
});

describe("markRecited", () => {
  it("returns a new state at the current position", () => {
    const next = markRecited({
      currentTurn: 10,
      currentToolCalls: 25,
      state: initialRecitationState(),
    });
    expect(next).toEqual({ lastRecitedTurn: 10, lastRecitedToolCalls: 25 });
  });

  it("does not mutate the input state", () => {
    const initial = initialRecitationState();
    markRecited({ currentTurn: 10, currentToolCalls: 25, state: initial });
    expect(initial).toEqual({ lastRecitedTurn: 0, lastRecitedToolCalls: 0 });
  });
});

describe("shouldRecite — full lifecycle", () => {
  it("fires at threshold, then resets after markRecited", () => {
    let state = initialRecitationState();
    let r = shouldRecite({ currentTurn: 8, currentToolCalls: 0, state }, { everyTurns: 8 });
    expect(r.shouldRecite).toBe(true);
    state = markRecited({ currentTurn: 8, currentToolCalls: 0, state });
    r = shouldRecite({ currentTurn: 10, currentToolCalls: 0, state }, { everyTurns: 8 });
    expect(r.shouldRecite).toBe(false);
    r = shouldRecite({ currentTurn: 16, currentToolCalls: 0, state }, { everyTurns: 8 });
    expect(r.shouldRecite).toBe(true);
  });
});

describe("buildRecitationBlock — content shape", () => {
  it("includes the goal line", () => {
    const block = buildRecitationBlock({ goal: "Trade ETH until Sharpe >= 1.5" });
    expect(block).toContain("Goal: Trade ETH until Sharpe >= 1.5");
  });

  it("includes progress when supplied", () => {
    const block = buildRecitationBlock({
      goal: "x",
      progressLines: ["scanned 20 candles", "computed RSI"],
    });
    expect(block).toContain("Done so far");
    expect(block).toContain("scanned 20 candles");
    expect(block).toContain("computed RSI");
  });

  it("includes blockers when supplied", () => {
    const block = buildRecitationBlock({
      goal: "x",
      blockers: ["awaiting fill confirmation"],
    });
    expect(block).toContain("Blockers");
    expect(block).toContain("awaiting fill confirmation");
  });

  it("includes checklist with status markers", () => {
    const block = buildRecitationBlock({
      goal: "x",
      checklist: [
        { item: "connect to broker", done: true },
        { item: "submit order", done: false },
      ],
    });
    expect(block).toContain("[x] connect to broker");
    expect(block).toContain("[ ] submit order");
  });

  it("omits sections that are empty", () => {
    const block = buildRecitationBlock({ goal: "x" });
    expect(block).not.toContain("Done so far");
    expect(block).not.toContain("Blockers");
    expect(block).not.toContain("Checklist");
  });
});

describe("recitationToPayload", () => {
  it("emits stable shape", () => {
    const p = recitationToPayload(
      { shouldRecite: true, reason: "cadence hit" },
      { everyTurns: 8, everyToolCalls: 20 },
    );
    expect(p.kind).toBe("recitation.checkpoint_recorded");
    expect(p.fired).toBe(true);
  });
});

describe("Manus scenario — long autonomous run", () => {
  it("recitation fires every 8 turns on a 50-turn task", () => {
    let state = initialRecitationState();
    const fired: number[] = [];
    for (let turn = 1; turn <= 50; turn++) {
      const r = shouldRecite({ currentTurn: turn, currentToolCalls: 0, state }, { everyTurns: 8 });
      if (r.shouldRecite) {
        fired.push(turn);
        state = markRecited({ currentTurn: turn, currentToolCalls: 0, state });
      }
    }
    expect(fired).toEqual([8, 16, 24, 32, 40, 48]);
  });
});
