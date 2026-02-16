/**
 * Playbook Mutator
 *
 * Core mutation engine for the Strategy Genome system.
 * Creates new playbook variants by applying parameter mutations
 * to PlaybookProtocol objects.
 *
 * Mutation types:
 * - Nudge:  small parameter changes (+/-10-20%)
 * - Shift:  larger parameter changes (+/-30-50%)
 * - Swap:   replace one indicator/method with another
 * - Add:    add a new condition or filter
 * - Remove: remove a condition or filter
 */

import { v4 as uuidv4 } from "uuid";
import { createModuleLogger } from "../../infra/logger/index.ts";
import type { PlaybookProtocol } from "../playbooks/protocol.ts";
import type { PlaybookBacktestResult } from "../backtesting/types.ts";
import type { Mutation } from "./types.ts";

const logger = createModuleLogger("playbook-mutator");

// ============================================================================
// Deep Clone & Path Utilities
// ============================================================================

/**
 * Deep clone a value using structured clone (safe for protocol objects).
 */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Get a value from an object using a dot-notation path.
 */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    const idx = Number(part);
    if (Array.isArray(current) && !Number.isNaN(idx)) {
      current = current[idx];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }
  return current;
}

/**
 * Set a value in an object using a dot-notation path.
 */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (current == null || typeof current !== "object") return;
    const idx = Number(part);
    if (Array.isArray(current) && !Number.isNaN(idx)) {
      current = current[idx];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }
  const lastPart = parts[parts.length - 1]!;
  if (current != null && typeof current === "object") {
    const idx = Number(lastPart);
    if (Array.isArray(current) && !Number.isNaN(idx)) {
      current[idx] = value;
    } else {
      (current as Record<string, unknown>)[lastPart] = value;
    }
  }
}

// ============================================================================
// Random Helpers
// ============================================================================

/** Random number between min and max (inclusive). */
function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Random integer between min and max (inclusive). */
function randInt(min: number, max: number): number {
  return Math.floor(randBetween(min, max + 1));
}

/** Pick a random element from an array. */
function randPick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Create a mutation object with common fields. */
function makeMutation(
  fieldPath: string,
  paramName: string,
  fromValue: unknown,
  toValue: unknown,
  mutationType: Mutation["mutation_type"],
  reason: string,
  suggestedBy: string = "Mutator",
): Mutation {
  return {
    mutation_id: uuidv4(),
    field_path: fieldPath,
    parameter_name: paramName,
    from_value: fromValue,
    to_value: toValue,
    mutation_type: mutationType,
    reason,
    suggested_by: suggestedBy,
    created_at: new Date().toISOString(),
  };
}

// ============================================================================
// Indicator Swap Options
// ============================================================================

/** Indicators that can be swapped for each other. */
const INDICATOR_SWAP_GROUPS: Record<string, string[]> = {
  momentum: ["RSI", "Stochastic", "MFI", "CCI"],
  trend: ["EMA", "SMA", "SuperTrend", "MACD"],
  volatility: ["ATR", "Bollinger", "Keltner"],
  volume: ["volume", "OBV", "VWAP"],
};

/** Find swap alternatives for an indicator name. */
function findSwapAlternatives(indicatorName: string): string[] {
  const upper = indicatorName.toUpperCase();
  for (const group of Object.values(INDICATOR_SWAP_GROUPS)) {
    if (group.some((g) => g.toUpperCase() === upper)) {
      return group.filter((g) => g.toUpperCase() !== upper);
    }
  }
  return [];
}

// ============================================================================
// PlaybookMutator
// ============================================================================

export class PlaybookMutator {
  /**
   * Apply a list of mutations to a protocol, returning the mutated copy.
   * The original protocol is not modified.
   */
  applyMutations(protocol: PlaybookProtocol, mutations: Mutation[]): PlaybookProtocol {
    const mutated = deepClone(protocol) as Record<string, unknown>;

    for (const mutation of mutations) {
      try {
        setByPath(mutated, mutation.field_path, mutation.to_value);
        logger.debug("Applied mutation", {
          field: mutation.field_path,
          from: String(mutation.from_value),
          to: String(mutation.to_value),
        });
      } catch (err) {
        logger.warn("Failed to apply mutation", {
          field: mutation.field_path,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Generate a new UUID and bumped version for the mutant
    mutated["id"] = uuidv4();
    const version = (protocol.version ?? "1.0.0").split(".");
    const patch = parseInt(version[2] ?? "0", 10) + 1;
    mutated["version"] = `${version[0]}.${version[1]}.${patch}`;

    // Update slug to indicate mutation
    const baseName = protocol.slug.replace(/-v\d+$/, "");
    mutated["slug"] = `${baseName}-v${patch}`;
    mutated["name"] = `${protocol.name} v${patch}`;

    return mutated as unknown as PlaybookProtocol;
  }

  /**
   * Suggest mutations based on backtest results.
   * Analyzes weaknesses in the backtest and proposes targeted fixes.
   */
  suggestMutationsFromBacktest(
    protocol: PlaybookProtocol,
    backtestResult: PlaybookBacktestResult,
  ): Mutation[] {
    const mutations: Mutation[] = [];
    const proto = protocol as unknown as Record<string, unknown>;

    // High max drawdown -> tighten stop loss
    if (backtestResult.max_drawdown_percent > 15) {
      const currentSL = protocol.exit.stop_loss.value;
      const tighterSL = Math.max(0.5, currentSL * 0.75);
      mutations.push(makeMutation(
        "exit.stop_loss.value",
        "Stop loss percentage",
        currentSL,
        Math.round(tighterSL * 100) / 100,
        "nudge",
        `High drawdown (${backtestResult.max_drawdown_percent.toFixed(1)}%) — tightening stop loss from ${currentSL}% to ${tighterSL.toFixed(2)}%`,
        "Backtester",
      ));
    }

    // Low win rate -> adjust entry indicator thresholds
    if (backtestResult.win_rate < 40 && protocol.entry.indicators.length > 0) {
      // Lower confluence requirement if possible
      if (protocol.entry.confluence_required > 1) {
        const newConf = protocol.entry.confluence_required - 1;
        mutations.push(makeMutation(
          "entry.confluence_required",
          "Confluence required",
          protocol.entry.confluence_required,
          newConf,
          "nudge",
          `Low win rate (${backtestResult.win_rate.toFixed(1)}%) — reducing confluence from ${protocol.entry.confluence_required} to ${newConf} to allow more selective entries`,
          "Backtester",
        ));
      }
    }

    // Short avg hold time -> widen take profit targets
    if (backtestResult.avg_hold_duration_hours < 2 && protocol.exit.take_profit.length > 0) {
      const firstTP = protocol.exit.take_profit[0]!;
      const widerLevel = firstTP.level * 1.3;
      mutations.push(makeMutation(
        "exit.take_profit.0.level",
        "Take profit level (R:R)",
        firstTP.level,
        Math.round(widerLevel * 100) / 100,
        "nudge",
        `Short avg hold (${backtestResult.avg_hold_duration_hours.toFixed(1)}h) — widening TP from ${firstTP.level}R to ${widerLevel.toFixed(2)}R`,
        "Backtester",
      ));
    }

    // Too few trades -> loosen entry conditions
    if (backtestResult.total_trades < 10) {
      // Try reducing confluence
      if (protocol.entry.confluence_required > 1) {
        // Only add if we haven't already added a confluence mutation
        const alreadyHasConf = mutations.some((m) => m.field_path === "entry.confluence_required");
        if (!alreadyHasConf) {
          mutations.push(makeMutation(
            "entry.confluence_required",
            "Confluence required",
            protocol.entry.confluence_required,
            Math.max(1, protocol.entry.confluence_required - 1),
            "nudge",
            `Too few trades (${backtestResult.total_trades}) — reducing confluence to generate more signals`,
            "Backtester",
          ));
        }
      }

      // Remove a filter if present
      if (protocol.entry.filters && protocol.entry.filters.length > 0) {
        const lastFilter = protocol.entry.filters[protocol.entry.filters.length - 1]!;
        const newFilters = protocol.entry.filters.slice(0, -1);
        mutations.push(makeMutation(
          "entry.filters",
          "Entry filters",
          protocol.entry.filters,
          newFilters,
          "remove",
          `Too few trades (${backtestResult.total_trades}) — removing filter "${lastFilter}" to loosen entry criteria`,
          "Backtester",
        ));
      }
    }

    // Low profit factor but decent win rate -> improve R:R ratio
    if (backtestResult.profit_factor < 1.2 && backtestResult.win_rate > 45) {
      if (protocol.exit.take_profit.length > 0) {
        const firstTP = protocol.exit.take_profit[0]!;
        // Only add if we haven't already added a TP mutation
        const alreadyHasTP = mutations.some((m) => m.field_path === "exit.take_profit.0.level");
        if (!alreadyHasTP) {
          const newLevel = firstTP.level * 1.2;
          mutations.push(makeMutation(
            "exit.take_profit.0.level",
            "Take profit level (R:R)",
            firstTP.level,
            Math.round(newLevel * 100) / 100,
            "nudge",
            `Low profit factor (${backtestResult.profit_factor.toFixed(2)}) with decent win rate — increasing TP target from ${firstTP.level}R to ${newLevel.toFixed(2)}R`,
            "Backtester",
          ));
        }
      }
    }

    return mutations;
  }

  /**
   * Suggest mutations for adapting to a market regime change.
   */
  suggestMutationsForRegime(
    protocol: PlaybookProtocol,
    currentRegime: string,
  ): Mutation[] {
    const mutations: Mutation[] = [];

    const regime = currentRegime.toLowerCase();

    if (regime === "volatile" || regime === "high_volatility") {
      // Tighten stop loss in volatile markets
      const currentSL = protocol.exit.stop_loss.value;
      const tighterSL = currentSL * 0.8;
      mutations.push(makeMutation(
        "exit.stop_loss.value",
        "Stop loss percentage",
        currentSL,
        Math.round(tighterSL * 100) / 100,
        "shift",
        `Volatile regime detected — tightening stop loss from ${currentSL}% to ${tighterSL.toFixed(2)}%`,
        "Analyst",
      ));

      // Reduce position sizing
      const currentRisk = protocol.risk.max_risk_per_trade_percent;
      const reducedRisk = currentRisk * 0.7;
      mutations.push(makeMutation(
        "risk.max_risk_per_trade_percent",
        "Max risk per trade %",
        currentRisk,
        Math.round(reducedRisk * 100) / 100,
        "shift",
        `Volatile regime — reducing risk per trade from ${currentRisk}% to ${reducedRisk.toFixed(2)}%`,
        "Analyst",
      ));
    }

    if (regime === "ranging" || regime === "sideways") {
      // Widen take profit targets in ranging markets
      if (protocol.exit.take_profit.length > 0) {
        const firstTP = protocol.exit.take_profit[0]!;
        const tighterTP = firstTP.level * 0.75;
        mutations.push(makeMutation(
          "exit.take_profit.0.level",
          "Take profit level (R:R)",
          firstTP.level,
          Math.round(tighterTP * 100) / 100,
          "shift",
          `Ranging regime — reducing TP target from ${firstTP.level}R to ${tighterTP.toFixed(2)}R (smaller moves expected)`,
          "Analyst",
        ));
      }

      // Increase confluence requirement for more selective entries
      if (protocol.entry.confluence_required < protocol.entry.indicators.length) {
        mutations.push(makeMutation(
          "entry.confluence_required",
          "Confluence required",
          protocol.entry.confluence_required,
          protocol.entry.confluence_required + 1,
          "nudge",
          "Ranging regime — increasing confluence to filter out false breakouts",
          "Analyst",
        ));
      }
    }

    if (regime === "trending") {
      // Widen take profit in trending markets
      if (protocol.exit.take_profit.length > 0) {
        const firstTP = protocol.exit.take_profit[0]!;
        const widerTP = firstTP.level * 1.4;
        mutations.push(makeMutation(
          "exit.take_profit.0.level",
          "Take profit level (R:R)",
          firstTP.level,
          Math.round(widerTP * 100) / 100,
          "shift",
          `Trending regime — widening TP target from ${firstTP.level}R to ${widerTP.toFixed(2)}R to capture larger moves`,
          "Analyst",
        ));
      }

      // Widen stop loss slightly to avoid premature shakeouts
      const currentSL = protocol.exit.stop_loss.value;
      const widerSL = currentSL * 1.2;
      mutations.push(makeMutation(
        "exit.stop_loss.value",
        "Stop loss percentage",
        currentSL,
        Math.round(widerSL * 100) / 100,
        "nudge",
        `Trending regime — widening stop from ${currentSL}% to ${widerSL.toFixed(2)}% to avoid shakeouts`,
        "Analyst",
      ));
    }

    if (regime === "quiet" || regime === "low_volatility") {
      // Loosen entry requirements to get more trades
      if (protocol.entry.confluence_required > 1) {
        mutations.push(makeMutation(
          "entry.confluence_required",
          "Confluence required",
          protocol.entry.confluence_required,
          protocol.entry.confluence_required - 1,
          "nudge",
          "Quiet regime — reducing confluence to generate more opportunities",
          "Analyst",
        ));
      }
    }

    return mutations;
  }

  /**
   * Generate random nudge mutations (small parameter perturbations).
   * Useful for creating quick variants without agent analysis.
   */
  generateNudgeMutations(protocol: PlaybookProtocol, count: number = 2): Mutation[] {
    const mutations: Mutation[] = [];
    const candidates: Array<() => Mutation | null> = [];

    // -- Numeric parameters that can be nudged --

    // Stop loss value
    candidates.push(() => {
      const current = protocol.exit.stop_loss.value;
      const factor = randBetween(0.8, 1.2);
      const newVal = Math.max(0.3, Math.round(current * factor * 100) / 100);
      if (newVal === current) return null;
      return makeMutation(
        "exit.stop_loss.value",
        "Stop loss percentage",
        current,
        newVal,
        "nudge",
        `Random nudge: stop loss ${current}% -> ${newVal}%`,
      );
    });

    // Take profit levels
    for (let i = 0; i < protocol.exit.take_profit.length; i++) {
      const tp = protocol.exit.take_profit[i]!;
      candidates.push(() => {
        const factor = randBetween(0.85, 1.15);
        const newLevel = Math.max(0.5, Math.round(tp.level * factor * 100) / 100);
        if (newLevel === tp.level) return null;
        return makeMutation(
          `exit.take_profit.${i}.level`,
          `Take profit level ${i + 1}`,
          tp.level,
          newLevel,
          "nudge",
          `Random nudge: TP${i + 1} ${tp.level}R -> ${newLevel}R`,
        );
      });
    }

    // Risk per trade
    candidates.push(() => {
      const current = protocol.risk.max_risk_per_trade_percent;
      const factor = randBetween(0.8, 1.2);
      const newVal = Math.max(0.1, Math.min(5, Math.round(current * factor * 100) / 100));
      if (newVal === current) return null;
      return makeMutation(
        "risk.max_risk_per_trade_percent",
        "Max risk per trade %",
        current,
        newVal,
        "nudge",
        `Random nudge: risk per trade ${current}% -> ${newVal}%`,
      );
    });

    // Indicator params (period values, etc.)
    for (let i = 0; i < protocol.entry.indicators.length; i++) {
      const indicator = protocol.entry.indicators[i]!;
      for (const [paramKey, paramVal] of Object.entries(indicator.params)) {
        if (typeof paramVal === "number") {
          candidates.push(() => {
            const factor = randBetween(0.8, 1.2);
            const newVal = Math.max(1, Math.round(paramVal * factor));
            if (newVal === paramVal) return null;
            return makeMutation(
              `entry.indicators.${i}.params.${paramKey}`,
              `${indicator.name} ${paramKey}`,
              paramVal,
              newVal,
              "nudge",
              `Random nudge: ${indicator.name} ${paramKey} ${paramVal} -> ${newVal}`,
            );
          });
        }
      }
    }

    // Confluence required
    if (protocol.entry.indicators.length > 1) {
      candidates.push(() => {
        const current = protocol.entry.confluence_required;
        const maxConf = protocol.entry.indicators.length;
        const options = [];
        if (current > 1) options.push(current - 1);
        if (current < maxConf) options.push(current + 1);
        if (options.length === 0) return null;
        const newVal = randPick(options);
        return makeMutation(
          "entry.confluence_required",
          "Confluence required",
          current,
          newVal,
          "nudge",
          `Random nudge: confluence ${current} -> ${newVal}`,
        );
      });
    }

    // Shuffle and pick up to `count` successful mutations
    const shuffled = candidates.sort(() => Math.random() - 0.5);
    for (const candidate of shuffled) {
      if (mutations.length >= count) break;
      const mutation = candidate();
      if (mutation) {
        mutations.push(mutation);
      }
    }

    logger.debug("Generated nudge mutations", { count: String(mutations.length) });
    return mutations;
  }

  /**
   * Crossover: combine parameters from two protocols.
   * Takes random sections from each parent to create a hybrid.
   */
  crossover(
    parent1: PlaybookProtocol,
    parent2: PlaybookProtocol,
  ): {
    protocol: PlaybookProtocol;
    mutations: Mutation[];
  } {
    const child = deepClone(parent1);
    const mutations: Mutation[] = [];

    // Randomly pick sections from parent2
    const sections: Array<{
      path: string;
      name: string;
      getter: (p: PlaybookProtocol) => unknown;
    }> = [
      { path: "exit.stop_loss", name: "Stop loss configuration", getter: (p) => p.exit.stop_loss },
      { path: "exit.take_profit", name: "Take profit levels", getter: (p) => p.exit.take_profit },
      { path: "risk", name: "Risk management", getter: (p) => p.risk },
      { path: "execution", name: "Execution config", getter: (p) => p.execution },
    ];

    for (const section of sections) {
      // 50% chance to take from parent2
      if (Math.random() > 0.5) {
        const fromVal = section.getter(parent1);
        const toVal = section.getter(parent2);

        if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
          setByPath(child as unknown as Record<string, unknown>, section.path, deepClone(toVal));
          mutations.push(makeMutation(
            section.path,
            section.name,
            fromVal,
            toVal,
            "swap",
            `Crossover: took ${section.name} from parent2`,
            "Mutator",
          ));
        }
      }
    }

    // Update identity
    child.id = uuidv4();
    const baseName = parent1.slug.replace(/-v\d+$/, "").replace(/-x\d+$/, "");
    const crossoverNum = randInt(1, 999);
    child.slug = `${baseName}-x${crossoverNum}`;
    child.name = `${parent1.name} x ${parent2.name}`;

    return { protocol: child, mutations };
  }
}
