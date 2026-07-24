/**
 * Trader Archetype Classifier (GORDON_TRADER_ARCHETYPE).
 *
 * Port of Wright Ch 8's "flaw audit" framework. Three personality
 * archetypes that each need different guardrails:
 *
 *   anxious_overthinker — sees danger everywhere, hesitates at entries,
 *     misses moves then chases. Needs: rigid checklists + entry timers.
 *   impulsive_action_taker — sees opportunity everywhere, trades for
 *     boredom, invents setups. Needs: friction between see and click.
 *   emotional_empath — viscerally feels market sentiment, panics with
 *     the crowd. Needs: outsource feelings to data.
 *
 * Wright's framing: "You're not trying to fix the flaw. You're building
 * around it." Operator self-reports their tendencies via behavior
 * signals; the classifier emits the archetype + the prescribed
 * guardrails. Most traders are blends — the function returns the
 * dominant archetype plus a confidence number.
 */

export type Archetype = "anxious_overthinker" | "impulsive_action_taker" | "emotional_empath" | "balanced";

export interface BehaviorSignals {
  /** Hesitates / second-guesses at entry. */
  hesitatesAtEntry?: boolean;
  /** Frequently misses entries then chases the move. */
  chasesAfterMissed?: boolean;
  /** Spends excessive time analyzing before clicking. */
  analysisParalysis?: boolean;
  /** Trades when nothing's setting up — boredom-driven. */
  tradesOutOfBoredom?: boolean;
  /** Invents setups that don't fit the playbook. */
  inventsSetups?: boolean;
  /** Reacts impulsively without journaling the thesis first. */
  fastClickReflex?: boolean;
  /** Visceral physical response to market moves (stomach drops). */
  visceralReaction?: boolean;
  /** Trades in the direction of crowd sentiment without checks. */
  follwsCrowdPanic?: boolean;
  /** P&L volatility correlates with operator mood. */
  moodLeaksIntoPnl?: boolean;
}

export interface ArchetypeResult {
  archetype: Archetype;
  scores: Record<Exclude<Archetype, "balanced">, number>;
  /** Confidence in [0, 1]. 1 = clear archetype, ≤0.4 = balanced. */
  confidence: number;
  recommendedGuardrails: string[];
}

const ANXIOUS_KEYS: Array<keyof BehaviorSignals> = [
  "hesitatesAtEntry",
  "chasesAfterMissed",
  "analysisParalysis",
];
const IMPULSIVE_KEYS: Array<keyof BehaviorSignals> = [
  "tradesOutOfBoredom",
  "inventsSetups",
  "fastClickReflex",
];
const EMPATH_KEYS: Array<keyof BehaviorSignals> = [
  "visceralReaction",
  "follwsCrowdPanic",
  "moodLeaksIntoPnl",
];

const GUARDRAILS: Record<Exclude<Archetype, "balanced">, string[]> = {
  anxious_overthinker: [
    "Rigid if/then entry checklist — no introspection in the moment",
    "30-60s decision timer; trade voids if not clicked",
    "Pre-defined exits — let the plan execute itself",
  ],
  impulsive_action_taker: [
    "Mandatory written thesis before any click — paper-pen friction",
    "Daily trade-count cap (e.g. 3 setups max)",
    "Platform lockout outside scheduled session windows",
  ],
  emotional_empath: [
    "Outsource sentiment read to VIX / put-call / funding extremes",
    "Use emotion as contrarian indicator — feel panic → check structure",
    "Hard daily-loss limit + circuit breaker (Rule of Three composes)",
  ],
};

function score(signals: BehaviorSignals, keys: Array<keyof BehaviorSignals>): number {
  let s = 0;
  for (const k of keys) if (signals[k] === true) s++;
  return s;
}

export function classifyTrader(signals: BehaviorSignals): ArchetypeResult {
  const a = score(signals, ANXIOUS_KEYS);
  const i = score(signals, IMPULSIVE_KEYS);
  const e = score(signals, EMPATH_KEYS);
  const total = a + i + e;

  if (total === 0) {
    return {
      archetype: "balanced",
      scores: { anxious_overthinker: 0, impulsive_action_taker: 0, emotional_empath: 0 },
      confidence: 0,
      recommendedGuardrails: [],
    };
  }

  let archetype: Archetype;
  let dominantScore: number;
  if (a >= i && a >= e) {
    archetype = "anxious_overthinker";
    dominantScore = a;
  } else if (i >= e) {
    archetype = "impulsive_action_taker";
    dominantScore = i;
  } else {
    archetype = "emotional_empath";
    dominantScore = e;
  }
  const confidence = dominantScore / total;

  let chosen: Exclude<Archetype, "balanced">[] = [];
  if (confidence < 0.5) {
    archetype = "balanced";
    chosen = ([
      ["anxious_overthinker", a],
      ["impulsive_action_taker", i],
      ["emotional_empath", e],
    ] as Array<[Exclude<Archetype, "balanced">, number]>)
      .filter(([, s]) => s >= 1)
      .map(([n]) => n);
  } else {
    chosen = [archetype as Exclude<Archetype, "balanced">];
  }

  const guardrails: string[] = [];
  for (const arch of chosen) guardrails.push(...GUARDRAILS[arch]);

  return {
    archetype,
    scores: {
      anxious_overthinker: a,
      impulsive_action_taker: i,
      emotional_empath: e,
    },
    confidence,
    recommendedGuardrails: guardrails,
  };
}

export function archetypeToPayload(result: ArchetypeResult): Record<string, unknown> {
  return {
    kind: "trader_archetype.classified",
    archetype: result.archetype,
    confidence: Number(result.confidence.toFixed(3)),
    scores: result.scores,
    guardrailCount: result.recommendedGuardrails.length,
  };
}
