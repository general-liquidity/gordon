/**
 * Turn-count Reminder Scheduler.
 *
 * In long autonomous loops (running unattended for hours), the model
 * gradually loses sight of constraints set at the top of the session —
 * risk limits, mandate boundaries, venue allowlists, even the user's
 * original goal. A periodic injection of these constraints back into
 * the prompt keeps the loop coherent.
 *
 * Inspired by OpenDev's `ProactiveReminderScheduler` which fires
 * templates on a turn counter (not a wall-clock timer — that drifts
 * relative to model usage). Each reminder declares a cadence
 * (`everyNTurns`) and a handler that produces the reminder text.
 *
 * Usage:
 *   const scheduler = new ReminderScheduler();
 *   scheduler.register({
 *     id: "risk-limits",
 *     everyNTurns: 10,
 *     handler: () => `Current daily loss limit: $${dailyLimit}.`,
 *   });
 *
 *   // Each turn:
 *   scheduler.advance();  // increments counter
 *   const reminders = scheduler.collect();  // returns due reminders
 *   if (reminders.length) prompt = `${reminders.join("\n")}\n\n${prompt}`;
 *
 * No LLM call. Pure state + deterministic dispatch.
 */

export interface ReminderRegistration {
  /** Unique ID — used for unregister and dedup. */
  id: string;
  /** Cadence — fires when (turn % everyNTurns === 0). Must be >= 1. */
  everyNTurns: number;
  /** Producer of the reminder text. Returning null skips this firing. */
  handler: (context: { turn: number }) => string | null;
  /** Optional priority — lower runs first when multiple fire. Default 100. */
  priority?: number;
  /** Skip the firing on turn 0 (typical desire — fresh session doesn't need re-state). Default true. */
  skipFirstTurn?: boolean;
}

interface RegistryEntry extends ReminderRegistration {
  // No internal state — cadence check is purely turn-modular.
}

export class ReminderScheduler {
  private turn: number = 0;
  private readonly registry: Map<string, RegistryEntry> = new Map();

  /**
   * Register a reminder. Returns an unregister function.
   * Throws if `everyNTurns < 1`.
   */
  register(reg: ReminderRegistration): () => void {
    if (reg.everyNTurns < 1 || !Number.isFinite(reg.everyNTurns)) {
      throw new Error(`everyNTurns must be >= 1, got ${reg.everyNTurns}`);
    }
    this.registry.set(reg.id, reg);
    return () => this.unregister(reg.id);
  }

  unregister(id: string): boolean {
    return this.registry.delete(id);
  }

  list(): ReminderRegistration[] {
    return [...this.registry.values()];
  }

  /** Advance the turn counter. Call once per turn before `collect`. */
  advance(): number {
    this.turn += 1;
    return this.turn;
  }

  currentTurn(): number {
    return this.turn;
  }

  /**
   * Run all registered handlers whose cadence is satisfied this turn.
   * Returns the reminder strings sorted by priority (lower first).
   * Handlers that throw or return null are filtered out.
   */
  collect(): string[] {
    const due: Array<{ id: string; priority: number; text: string }> = [];

    for (const reg of this.registry.values()) {
      if (this.turn === 0 && (reg.skipFirstTurn ?? true)) continue;
      if (this.turn % reg.everyNTurns !== 0) continue;

      let text: string | null;
      try {
        text = reg.handler({ turn: this.turn });
      } catch {
        // Handler bugs must never crash the scheduler.
        continue;
      }
      if (!text?.trim()) continue;

      due.push({ id: reg.id, priority: reg.priority ?? 100, text: text.trim() });
    }

    due.sort((a, b) => a.priority - b.priority);
    return due.map((d) => d.text);
  }

  /** Test / engine-reset hook. */
  reset(): void {
    this.turn = 0;
    this.registry.clear();
  }
}

// ============================================================================
// Default trading-relevant reminder factories
// ============================================================================

/**
 * Builds a reminder that re-states the current daily loss limit. Wire
 * this at session start with the loaded mandate; the scheduler will
 * re-emit it every N turns to keep the limit visible to the model in
 * long autonomous loops.
 */
export function dailyLossLimitReminder(getDailyLimitUsd: () => number): ReminderRegistration {
  return {
    id: "daily-loss-limit",
    everyNTurns: 10,
    priority: 10,
    handler: () => {
      const limit = getDailyLimitUsd();
      if (!Number.isFinite(limit) || limit <= 0) return null;
      return `[GORDON_REMINDER] Daily loss limit is $${limit.toFixed(2)}. Refuse trades that would exceed it.`;
    },
  };
}

/**
 * Re-states the active mandate ID + venue allowlist. Useful in
 * autonomous loops where the model can drift from the mandate scope.
 */
export function mandateScopeReminder(
  getMandate: () => { id: string; venues: string[]; expiresAt?: string } | null,
): ReminderRegistration {
  return {
    id: "mandate-scope",
    everyNTurns: 15,
    priority: 5,
    handler: () => {
      const m = getMandate();
      if (!m) return null;
      const expiry = m.expiresAt ? ` Expires ${m.expiresAt}.` : "";
      return `[GORDON_REMINDER] Active mandate ${m.id} restricts venues to: ${m.venues.join(", ")}.${expiry}`;
    },
  };
}

/**
 * Reminds the agent to check open positions every N turns — long
 * autonomous loops sometimes lose track of what's already on the books.
 */
export function openPositionsReminder(getPositionCount: () => number): ReminderRegistration {
  return {
    id: "open-positions",
    everyNTurns: 20,
    priority: 50,
    handler: () => {
      const n = getPositionCount();
      if (n === 0) return null;
      return `[GORDON_REMINDER] You have ${n} open position${n === 1 ? "" : "s"}. Check status before opening new ones.`;
    },
  };
}
