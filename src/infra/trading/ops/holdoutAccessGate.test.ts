import { describe, expect, it } from "bun:test";
import {
  canEvaluate,
  recordEvaluation,
  isEvaluable,
  emptyEvalState,
  type HoldoutAccessConfig,
} from "./holdoutAccessGate.ts";

const config: HoldoutAccessConfig = {
  policies: [
    { split: "train", access: "trainable", budget: 3 },
    { split: "validation", access: "trainable" }, // unbounded
    { split: "test", access: "locked" },
  ],
};

describe("holdoutAccessGate", () => {
  it("a locked split is never evaluable, whatever the usage", () => {
    const fresh = canEvaluate(config, "test", emptyEvalState());
    expect(fresh.allowed).toBe(false);
    if (!fresh.allowed) expect(fresh.reason).toBe("locked");

    // even with zero usage recorded elsewhere, test stays denied
    const used = recordEvaluation(recordEvaluation(emptyEvalState(), "train"), "train");
    const stillLocked = canEvaluate(config, "test", used);
    expect(stillLocked.allowed).toBe(false);
  });

  it("a trainable split within budget passes and reports remaining", () => {
    const d = canEvaluate(config, "train", emptyEvalState());
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.remaining).toBe(3);
  });

  it("an exhausted budget blocks", () => {
    let state = emptyEvalState();
    for (let i = 0; i < 3; i++) {
      expect(isEvaluable(config, "train", state)).toBe(true);
      state = recordEvaluation(state, "train");
    }
    const d = canEvaluate(config, "train", state);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("budget_exhausted");
  });

  it("an unbounded trainable split never exhausts", () => {
    let state = emptyEvalState();
    for (let i = 0; i < 100; i++) state = recordEvaluation(state, "validation");
    const d = canEvaluate(config, "validation", state);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.remaining).toBeNull();
  });

  it("an unknown split is denied, not implicitly trainable", () => {
    const d = canEvaluate(config, "mystery", emptyEvalState());
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("unknown_split");
  });

  it("recordEvaluation is pure — it does not mutate the input state", () => {
    const before = emptyEvalState();
    const after = recordEvaluation(before, "train");
    expect(before.usage.train).toBeUndefined();
    expect(after.usage.train).toBe(1);
  });
});
