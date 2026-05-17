import { describe, it, expect } from "bun:test";

import {
  isTraderArchetypeEnabled,
  classifyTrader,
  archetypeToPayload,
  TRADER_ARCHETYPE_FLAG_ENV,
} from "./traderArchetype.ts";

describe("isTraderArchetypeEnabled", () => {
  it("respects the flag", () => {
    expect(isTraderArchetypeEnabled({})).toBe(false);
    expect(isTraderArchetypeEnabled({ [TRADER_ARCHETYPE_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("classifyTrader — pure archetypes", () => {
  it("all anxious signals → anxious_overthinker", () => {
    const r = classifyTrader({
      hesitatesAtEntry: true,
      chasesAfterMissed: true,
      analysisParalysis: true,
    });
    expect(r.archetype).toBe("anxious_overthinker");
    expect(r.confidence).toBe(1);
    expect(r.recommendedGuardrails.some((s) => s.includes("checklist"))).toBe(true);
  });

  it("all impulsive signals → impulsive_action_taker", () => {
    const r = classifyTrader({
      tradesOutOfBoredom: true,
      inventsSetups: true,
      fastClickReflex: true,
    });
    expect(r.archetype).toBe("impulsive_action_taker");
    expect(r.recommendedGuardrails.some((s) => s.includes("lockout"))).toBe(true);
  });

  it("all empath signals → emotional_empath", () => {
    const r = classifyTrader({
      visceralReaction: true,
      follwsCrowdPanic: true,
      moodLeaksIntoPnl: true,
    });
    expect(r.archetype).toBe("emotional_empath");
    expect(r.recommendedGuardrails.some((s) => s.includes("contrarian"))).toBe(true);
  });
});

describe("classifyTrader — no signals", () => {
  it("empty signals → balanced with empty guardrails", () => {
    const r = classifyTrader({});
    expect(r.archetype).toBe("balanced");
    expect(r.confidence).toBe(0);
    expect(r.recommendedGuardrails).toEqual([]);
  });
});

describe("classifyTrader — blends", () => {
  it("clear dominant archetype with secondary signals → dominant wins", () => {
    const r = classifyTrader({
      hesitatesAtEntry: true,
      chasesAfterMissed: true,
      analysisParalysis: true,
      tradesOutOfBoredom: true,
    });
    expect(r.archetype).toBe("anxious_overthinker");
    expect(r.confidence).toBeCloseTo(3 / 4, 3);
  });

  it("close-to-tie spread → balanced with multi-archetype guardrails", () => {
    const r = classifyTrader({
      hesitatesAtEntry: true,
      tradesOutOfBoredom: true,
      visceralReaction: true,
    });
    expect(r.archetype).toBe("balanced");
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.recommendedGuardrails.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Wright Ch 8 — scenario from the chapter", () => {
  it("the 'anxious wreck' trader from Wright's desk → anxious_overthinker", () => {
    const r = classifyTrader({
      hesitatesAtEntry: true,
      analysisParalysis: true,
    });
    expect(r.archetype).toBe("anxious_overthinker");
    expect(r.recommendedGuardrails.some((s) => s.toLowerCase().includes("timer"))).toBe(true);
  });
});

describe("archetypeToPayload", () => {
  it("emits stable shape", () => {
    const r = classifyTrader({ tradesOutOfBoredom: true, inventsSetups: true });
    const p = archetypeToPayload(r) as { kind: string; archetype: string };
    expect(p.kind).toBe("trader_archetype.classified");
    expect(p.archetype).toBe("impulsive_action_taker");
  });
});
