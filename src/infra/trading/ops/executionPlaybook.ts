/**
 * Execution Playbook (GORDON_EXECUTION_PLAYBOOK).
 *
 * Port of the trading-vs-execution playbook distinction from
 * TraderMorin's article (2026):
 *
 *   "Just like I have trading playbooks, I also have execution playbooks.
 *    Some execution playbooks can be used across multiple trading
 *    playbooks while others are specific to one playbook."
 *
 * Today Gordon's `src/core/playbooks/builtin/` conflates *what signal
 * generates this trade* with *how do I enter/exit it.* This module
 * separates execution shape from signal logic, so multi-clip entry
 * templates and partial-close ladders become first-class data the
 * agent (and the operator) can pick by name.
 *
 * Why it matters: the trader's edge-finding lever is per-execution-
 * playbook performance tracking. "Single-shot-on-confirmation" might
 * outperform "scaled-in-thirds" on Mean Reversion setups but lose on
 * Range Extremity — and you only know this if execution shape is
 * attached to the trade record by name.
 */

export const EXECUTION_PLAYBOOK_FLAG_ENV = "GORDON_EXECUTION_PLAYBOOK";

/** Single entry clip in a scaled-entry schedule. */
export interface EntryClip {
  /** Fraction of total intended size (sums to 1.0 across all clips). */
  sizeFraction: number;
  /** Price offset from the entry reference (e.g. limit at entry, or +0.2 ATR away). */
  priceOffsetAtr?: number;
  /** Or an absolute price (mutually exclusive with priceOffsetAtr). */
  absolutePrice?: number;
  /** Optional condition that must hold for this clip to fire (free text). */
  condition?: string;
}

/** Exit instructions for a trade. */
export interface ExitClip {
  /** Fraction of position to close at this point. */
  sizeFraction: number;
  /** Triggered at R-multiple from entry (e.g. 1 = take half at +1R). */
  atRMultiple?: number;
  /** Or absolute price target. */
  absolutePrice?: number;
  /** Free-text description. */
  description?: string;
}

/** Stop-loss management rules. */
export interface StopRules {
  /** Initial stop placement at R-multiple below entry. */
  initialStopAtR: number;
  /** Move stop to break-even when this R-multiple is reached. */
  moveToBreakEvenAtR?: number;
  /** Activate trailing stop at this R-multiple. */
  trailActivateAtR?: number;
  /** Trail distance in ATR units once active. */
  trailDistanceAtr?: number;
}

/** Compatibility hint — which trading playbooks this execution shape fits. */
export type CompatibilityHint = "trend_continuation" | "mean_reversion" | "range_extremity" | "breakout" | "scalp" | "any";

export interface ExecutionPlaybook {
  /** Stable identifier (e.g. "scaled-3-clip-mean-rev"). */
  id: string;
  /** Human-friendly name. */
  name: string;
  /** Short description shown to operators. */
  description: string;
  /** Trading-playbook archetypes this fits well with. */
  compatibility: CompatibilityHint[];
  /** Entry plan — single clip or scaled. */
  entry: EntryClip[];
  /** Exit ladder — empty array means "single exit at full target." */
  exits: ExitClip[];
  /** Stop management rules. */
  stops: StopRules;
  /** Optional notes for the operator. */
  notes?: string[];
}

export interface ExecutionPlan {
  /** Plan id this execution is attached to. */
  planId: string;
  /** Which playbook was selected. */
  playbookId: string;
  /** The actual entries scheduled (resolved prices computed from the playbook + plan context). */
  scheduledEntries: Array<EntryClip & { resolvedPrice?: number }>;
  /** Same for exits. */
  scheduledExits: Array<ExitClip & { resolvedPrice?: number }>;
  /** Resolved stop placement. */
  resolvedStop?: number;
  /** ISO timestamp when execution plan was built. */
  createdAt: string;
}

// ============================================================================
// Built-in playbooks
// ============================================================================

const SINGLE_SHOT: ExecutionPlaybook = {
  id: "single-shot",
  name: "Single Shot",
  description: "Fire the full intended size in one order at the entry price.",
  compatibility: ["any"],
  entry: [{ sizeFraction: 1.0 }],
  exits: [{ sizeFraction: 1.0, description: "full exit at target" }],
  stops: { initialStopAtR: 1.0 },
};

const SCALED_THIRDS: ExecutionPlaybook = {
  id: "scaled-thirds",
  name: "Scaled Thirds",
  description: "Three equal clips: at entry, on first confirmation pullback, on second.",
  compatibility: ["trend_continuation", "mean_reversion"],
  entry: [
    { sizeFraction: 0.33, condition: "at entry price" },
    { sizeFraction: 0.33, priceOffsetAtr: -0.5, condition: "first 0.5 ATR pullback" },
    { sizeFraction: 0.34, priceOffsetAtr: -1.0, condition: "second pullback or confirmation" },
  ],
  exits: [
    { sizeFraction: 0.5, atRMultiple: 1.0, description: "half off at +1R" },
    { sizeFraction: 0.5, atRMultiple: 2.0, description: "remainder at +2R or trail" },
  ],
  stops: { initialStopAtR: 1.0, moveToBreakEvenAtR: 1.0, trailActivateAtR: 1.5, trailDistanceAtr: 1.0 },
  notes: ["Reduces average entry cost on pullbacks; uses break-even stop once first target hit."],
};

const BREAKOUT_CONFIRM: ExecutionPlaybook = {
  id: "breakout-confirm",
  name: "Breakout Confirmation",
  description: "Half clip on breakout, half on retest hold.",
  compatibility: ["breakout", "trend_continuation"],
  entry: [
    { sizeFraction: 0.5, condition: "on confirmed breakout (close above/below)" },
    { sizeFraction: 0.5, condition: "on successful retest of broken level" },
  ],
  exits: [
    { sizeFraction: 0.33, atRMultiple: 1.0 },
    { sizeFraction: 0.33, atRMultiple: 2.0 },
    { sizeFraction: 0.34, atRMultiple: 3.0, description: "runner with trail" },
  ],
  stops: { initialStopAtR: 1.0, moveToBreakEvenAtR: 1.5, trailActivateAtR: 2.0, trailDistanceAtr: 1.5 },
};

const RANGE_EXTREMITY_FADE: ExecutionPlaybook = {
  id: "range-extremity-fade",
  name: "Range Extremity Fade",
  description: "Two clips fading the range extreme: at extreme, second on first rejection.",
  compatibility: ["range_extremity", "mean_reversion"],
  entry: [
    { sizeFraction: 0.5, condition: "at range extreme" },
    { sizeFraction: 0.5, condition: "on first rejection candle / wick" },
  ],
  exits: [
    { sizeFraction: 0.5, description: "half at range midpoint" },
    { sizeFraction: 0.5, description: "remainder at opposite extreme or trail" },
  ],
  stops: { initialStopAtR: 0.7, moveToBreakEvenAtR: 1.0 },
  notes: ["Tighter initial stop because range fade is invalidated quickly on a clean break."],
};

const SCALP_SINGLE: ExecutionPlaybook = {
  id: "scalp-single",
  name: "Scalp Single",
  description: "Fast single-shot with tight stop and partial at 1R.",
  compatibility: ["scalp"],
  entry: [{ sizeFraction: 1.0 }],
  exits: [
    { sizeFraction: 0.75, atRMultiple: 1.0, description: "majority off at +1R" },
    { sizeFraction: 0.25, atRMultiple: 1.5, description: "runner" },
  ],
  stops: { initialStopAtR: 0.5 },
};

export const BUILTIN_PLAYBOOKS: readonly ExecutionPlaybook[] = [
  SINGLE_SHOT,
  SCALED_THIRDS,
  BREAKOUT_CONFIRM,
  RANGE_EXTREMITY_FADE,
  SCALP_SINGLE,
];

const _registry = new Map<string, ExecutionPlaybook>(BUILTIN_PLAYBOOKS.map((p) => [p.id, p]));

export function resetRegistryForTesting(): void {
  _registry.clear();
  for (const p of BUILTIN_PLAYBOOKS) _registry.set(p.id, p);
}

export function listPlaybooks(): readonly ExecutionPlaybook[] {
  return Array.from(_registry.values());
}

export function getPlaybook(id: string): ExecutionPlaybook | null {
  return _registry.get(id) ?? null;
}

export function registerPlaybook(playbook: ExecutionPlaybook): void {
  // Validate fractions sum to ~1
  const entrySum = playbook.entry.reduce((s, c) => s + c.sizeFraction, 0);
  if (Math.abs(entrySum - 1) > 0.01) {
    throw new Error(`Execution playbook "${playbook.id}" entry fractions must sum to 1 (got ${entrySum})`);
  }
  if (playbook.exits.length > 0) {
    const exitSum = playbook.exits.reduce((s, c) => s + c.sizeFraction, 0);
    if (Math.abs(exitSum - 1) > 0.01) {
      throw new Error(`Execution playbook "${playbook.id}" exit fractions must sum to 1 (got ${exitSum})`);
    }
  }
  _registry.set(playbook.id, playbook);
}

export function isExecutionPlaybookEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[EXECUTION_PLAYBOOK_FLAG_ENV] === "1" ||
    env[EXECUTION_PLAYBOOK_FLAG_ENV] === "true"
  );
}

// ============================================================================
// Attach + resolve
// ============================================================================

export interface AttachInput {
  planId: string;
  playbookId: string;
  /** Reference entry price from the plan (resolved offsets are computed from this). */
  entryPrice: number;
  /** Average true range used to translate priceOffsetAtr → absolute. Optional. */
  atr?: number;
  /** Initial stop price, used to compute R distance for exit targets. Optional. */
  stopPrice?: number;
  /** Trade direction. Used to flip R-multiple math for shorts. */
  direction: "long" | "short";
  /** Override clock for tests. */
  now?: string;
}

export class PlaybookNotFoundError extends Error {
  constructor(id: string) {
    super(`Execution playbook not found: ${id}`);
    this.name = "PlaybookNotFoundError";
  }
}

/**
 * Resolve a playbook's relative entries/exits against a concrete plan.
 * Computes absolute prices when the inputs allow (entryPrice + atr for
 * offsets, entryPrice + stopPrice for R-multiples).
 *
 *   - LONG: stop below entry, exits above
 *   - SHORT: stop above entry, exits below
 */
export function attachExecution(input: AttachInput): ExecutionPlan {
  const playbook = getPlaybook(input.playbookId);
  if (!playbook) throw new PlaybookNotFoundError(input.playbookId);

  const directionSign = input.direction === "long" ? 1 : -1;
  const rDistance =
    input.stopPrice !== undefined
      ? Math.abs(input.entryPrice - input.stopPrice)
      : undefined;

  const scheduledEntries = playbook.entry.map((clip) => {
    let resolvedPrice: number | undefined;
    if (clip.absolutePrice !== undefined) {
      resolvedPrice = clip.absolutePrice;
    } else if (clip.priceOffsetAtr !== undefined && input.atr !== undefined) {
      resolvedPrice = input.entryPrice + clip.priceOffsetAtr * input.atr * directionSign;
    } else {
      resolvedPrice = input.entryPrice;
    }
    return { ...clip, resolvedPrice };
  });

  const scheduledExits = playbook.exits.map((clip) => {
    let resolvedPrice: number | undefined;
    if (clip.absolutePrice !== undefined) {
      resolvedPrice = clip.absolutePrice;
    } else if (clip.atRMultiple !== undefined && rDistance !== undefined) {
      resolvedPrice = input.entryPrice + clip.atRMultiple * rDistance * directionSign;
    }
    return { ...clip, resolvedPrice };
  });

  const resolvedStop = input.stopPrice;

  return {
    planId: input.planId,
    playbookId: input.playbookId,
    scheduledEntries,
    scheduledExits,
    resolvedStop,
    createdAt: input.now ?? new Date().toISOString(),
  };
}

export function formatPlaybook(playbook: ExecutionPlaybook): string {
  const lines: string[] = [];
  lines.push(`${playbook.name} (${playbook.id}) — ${playbook.description}`);
  lines.push(`  Compatibility: ${playbook.compatibility.join(", ")}`);
  lines.push(`  Entry clips (${playbook.entry.length}):`);
  for (const c of playbook.entry) {
    const pct = (c.sizeFraction * 100).toFixed(0);
    lines.push(`    - ${pct}%${c.condition ? ` — ${c.condition}` : ""}`);
  }
  if (playbook.exits.length > 0) {
    lines.push(`  Exit clips (${playbook.exits.length}):`);
    for (const c of playbook.exits) {
      const pct = (c.sizeFraction * 100).toFixed(0);
      const at = c.atRMultiple ? ` at +${c.atRMultiple}R` : "";
      lines.push(`    - ${pct}%${at}${c.description ? ` — ${c.description}` : ""}`);
    }
  }
  lines.push(`  Stops: initial ${playbook.stops.initialStopAtR}R${playbook.stops.moveToBreakEvenAtR ? `, BE at +${playbook.stops.moveToBreakEvenAtR}R` : ""}${playbook.stops.trailActivateAtR ? `, trail at +${playbook.stops.trailActivateAtR}R` : ""}`);
  return lines.join("\n");
}

export function planToPayload(plan: ExecutionPlan): Record<string, unknown> {
  return {
    kind: "execution_playbook.plan_recorded",
    planId: plan.planId,
    playbookId: plan.playbookId,
    entryClipCount: plan.scheduledEntries.length,
    exitClipCount: plan.scheduledExits.length,
    resolvedStop: plan.resolvedStop,
    createdAt: plan.createdAt,
  };
}

const STRATEGY_PLAYBOOK_MAP: Record<string, string> = {
  support_bounce: "scaled-thirds",
  bollinger_bounce: "scaled-thirds",
  vwap_bounce: "scaled-thirds",
  sma_crossover: "scaled-thirds",
  consolidation_pop: "breakout-confirm",
  adx_trend: "breakout-confirm",
  volume_surge: "breakout-confirm",
  engulfing_pattern: "breakout-confirm",
  ema_rsi_crossover: "breakout-confirm",
  relative_strength: "breakout-confirm",
  grid_entry: "single-shot",
};

/**
 * Pick a built-in execution playbook for a trading strategy tag.
 */
export function selectPlaybookForStrategy(strategy: string): ExecutionPlaybook {
  const id = STRATEGY_PLAYBOOK_MAP[strategy] ?? "single-shot";
  return getPlaybook(id) ?? getPlaybook("single-shot") ?? SINGLE_SHOT;
}
