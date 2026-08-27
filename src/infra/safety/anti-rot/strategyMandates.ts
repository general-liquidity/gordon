/**
 * Per-strategy mandate decomposition (GORDON_STRATEGY_MANDATES).
 *
 * Anti-god-object guard: instead of one mandate covering all asset
 * classes + horizons + risk profiles, allow multiple named mandates
 * each with its own scope and risk budget. Plans route to the matching
 * mandate by asset class / venue / strategy tag. Translation of the
 * "god object is the default AI artifact" tenet from k10s.dev — a
 * single PortfolioContext holding everything obscures cross-strategy
 * conflicts.
 *
 * MVP scope: registry + matching + per-mandate risk budget check.
 * Additive — does NOT replace the existing global mandate.
 * Persistence: ~/.gordon/strategy-mandates.json.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { flagEnv } from "../../config/flagResolver.ts";

export interface StrategyMandate {
  id: string;
  name: string;
  /** Asset classes this mandate covers. Empty = matches any. */
  assetClasses: string[];
  /** Venues this mandate covers. Empty = matches any. */
  venues: string[];
  /** Strategy tags this mandate covers (e.g. "swing", "scalp"). Empty = matches any. */
  strategyTags: string[];
  /** Max % of portfolio per single trade under this mandate. */
  maxPositionPct: number;
  /** Max % of portfolio total allocated to this mandate at once. */
  maxAllocationPct: number;
  /** Max number of simultaneous open positions under this mandate. */
  maxOpenPositions: number;
  note?: string;
  declaredAt: string;
}

let cachedMandates: StrategyMandate[] | null = null;

export function isStrategyMandatesEnabled(env: NodeJS.ProcessEnv = flagEnv()): boolean {
  return env.GORDON_STRATEGY_MANDATES === "1" || env.GORDON_STRATEGY_MANDATES === "true";
}

export function defaultMandatesPath(): string {
  const fromEnv = process.env.GORDON_STRATEGY_MANDATES_PATH;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".gordon", "strategy-mandates.json");
}

export function loadMandates(path: string = defaultMandatesPath()): StrategyMandate[] {
  if (cachedMandates) return cachedMandates;
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { mandates?: StrategyMandate[] };
    const list = Array.isArray(raw.mandates)
      ? raw.mandates.map((m) => ({
          ...m,
          assetClasses: (m.assetClasses ?? []).map((s) => s.toLowerCase()),
          venues: (m.venues ?? []).map((s) => s.toLowerCase()),
          strategyTags: (m.strategyTags ?? []).map((s) => s.toLowerCase()),
        }))
      : [];
    cachedMandates = list;
    return list;
  } catch {
    return [];
  }
}

export function saveMandates(
  mandates: StrategyMandate[],
  path: string = defaultMandatesPath(),
): StrategyMandate[] {
  const normalized = mandates.map((m) => ({
    ...m,
    assetClasses: (m.assetClasses ?? []).map((s) => s.toLowerCase()),
    venues: (m.venues ?? []).map((s) => s.toLowerCase()),
    strategyTags: (m.strategyTags ?? []).map((s) => s.toLowerCase()),
    declaredAt: m.declaredAt || new Date().toISOString(),
  }));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ mandates: normalized }, null, 2), "utf8");
  cachedMandates = normalized;
  return normalized;
}

export function _resetMandatesCacheForTest(): void {
  cachedMandates = null;
}

export interface MandateMatchInput {
  assetClass?: string;
  venue?: string;
  strategyTag?: string;
}

/**
 * Select the most-specific mandate that matches the plan's
 * (assetClass, venue, strategyTag). Specificity scoring: a mandate that
 * explicitly lists the input value scores higher than a wildcard.
 * Mandates that list the dimension but don't include the input value
 * are rejected outright.
 */
export function selectMandateForPlan(
  input: MandateMatchInput,
  mandates: StrategyMandate[] = loadMandates(),
): StrategyMandate | null {
  let best: { m: StrategyMandate; score: number } | null = null;

  for (const m of mandates) {
    let score = 0;
    let mismatched = false;

    if (input.assetClass) {
      const ac = input.assetClass.toLowerCase();
      if (m.assetClasses.length === 0) {
        // wildcard
      } else if (m.assetClasses.includes(ac)) {
        score += 3;
      } else {
        mismatched = true;
      }
    }

    if (input.venue && !mismatched) {
      const v = input.venue.toLowerCase();
      if (m.venues.length === 0) {
        // wildcard
      } else if (m.venues.includes(v)) {
        score += 2;
      } else {
        mismatched = true;
      }
    }

    if (input.strategyTag && !mismatched) {
      const st = input.strategyTag.toLowerCase();
      if (m.strategyTags.length === 0) {
        // wildcard
      } else if (m.strategyTags.includes(st)) {
        score += 1;
      } else {
        mismatched = true;
      }
    }

    if (mismatched) continue;
    if (!best || score > best.score) {
      best = { m, score };
    }
  }

  return best?.m ?? null;
}

export interface MandateBudgetState {
  currentOpenPositions: number;
  /** Current % of portfolio allocated to this mandate. */
  currentAllocationPct: number;
}

export interface MandateGateInput {
  proposedPositionPct: number;
}

export interface MandateGateResult {
  ok: boolean;
  mandate: StrategyMandate | null;
  violations: string[];
  reason?: string;
}

export function gateAgainstMandate(
  input: MandateMatchInput & MandateGateInput,
  budgetState: MandateBudgetState,
  env: NodeJS.ProcessEnv = flagEnv(),
  mandates: StrategyMandate[] = loadMandates(),
): MandateGateResult {
  if (!isStrategyMandatesEnabled(env)) {
    return { ok: true, mandate: null, violations: [] };
  }
  if (mandates.length === 0) {
    return { ok: true, mandate: null, violations: [] };
  }
  const m = selectMandateForPlan(input, mandates);
  if (!m) {
    return {
      ok: false,
      mandate: null,
      violations: ["no strategy mandate matches this plan"],
      reason:
        `GORDON_STRATEGY_MANDATES is enabled and no mandate matches this plan ` +
        `(assetClass=${input.assetClass ?? "?"}, venue=${input.venue ?? "?"}, strategyTag=${input.strategyTag ?? "?"}). ` +
        `Either revise the plan to fit an existing mandate, or declare a new mandate via set_strategy_mandate.`,
    };
  }
  const violations: string[] = [];
  if (input.proposedPositionPct > m.maxPositionPct) {
    violations.push(
      `proposed position size ${input.proposedPositionPct.toFixed(2)}% exceeds mandate '${m.name}' max ${m.maxPositionPct}%`,
    );
  }
  if (budgetState.currentAllocationPct + input.proposedPositionPct > m.maxAllocationPct) {
    const total = budgetState.currentAllocationPct + input.proposedPositionPct;
    violations.push(
      `would push mandate '${m.name}' allocation to ${total.toFixed(2)}% (max ${m.maxAllocationPct}%)`,
    );
  }
  if (budgetState.currentOpenPositions >= m.maxOpenPositions) {
    violations.push(
      `mandate '${m.name}' already at ${budgetState.currentOpenPositions}/${m.maxOpenPositions} open positions`,
    );
  }
  if (violations.length === 0) {
    return { ok: true, mandate: m, violations: [] };
  }
  return {
    ok: false,
    mandate: m,
    violations,
    reason:
      `Plan violates strategy mandate '${m.name}'. ` +
      `Violations: ${violations.join("; ")}. ` +
      `Anti-god-object guard: this mandate exists to scope a specific strategy; revise the plan or route to a different mandate.`,
  };
}
