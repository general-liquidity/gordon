/**
 * Portfolio coherence vs. running thesis (GORDON_THESIS_COHERENCE).
 *
 * Anti-portfolio-rot guard: trader declares a running thesis with
 * structured fields (bias, market focus, time horizon, conviction
 * floor). Every plan is scored against the thesis; below threshold,
 * execute_plan blocks. Translation of "AI builds features, not
 * architecture" from k10s.dev — each Gordon plan is locally fine, but
 * cumulative drift produces an incoherent portfolio.
 *
 * Persistence: ~/.gordon/running-thesis.json (override via
 * GORDON_RUNNING_THESIS_PATH). Threshold via
 * GORDON_THESIS_COHERENCE_THRESHOLD (default 0.5).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type ThesisBias = "long" | "short" | "neutral";
export type ThesisHorizon = "intraday" | "swing" | "position";

export interface RunningThesis {
  bias: ThesisBias;
  /** Asset classes the trader is focused on. Empty = no restriction. */
  marketFocus: string[];
  timeHorizon: ThesisHorizon;
  /** 1-10. Minimum conviction required for a plan. */
  convictionMin: number;
  /** Trader's verbatim note. */
  note: string;
  declaredAt: string;
  expiresAt?: string;
}

let cachedThesis: RunningThesis | null = null;

export function isCoherenceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.GORDON_THESIS_COHERENCE === "1" ||
    env.GORDON_THESIS_COHERENCE === "true"
  );
}

export function defaultThesisPath(): string {
  const fromEnv = process.env.GORDON_RUNNING_THESIS_PATH;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".gordon", "running-thesis.json");
}

const DEFAULT_COHERENCE_THRESHOLD = 0.5;

export function getCoherenceThreshold(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.GORDON_THESIS_COHERENCE_THRESHOLD;
  if (!raw) return DEFAULT_COHERENCE_THRESHOLD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return DEFAULT_COHERENCE_THRESHOLD;
  return n;
}

export function loadRunningThesis(
  path: string = defaultThesisPath(),
): RunningThesis | null {
  if (cachedThesis) return cachedThesis;
  if (!existsSync(path)) return null;
  try {
    const t = JSON.parse(readFileSync(path, "utf8")) as RunningThesis;
    if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now()) {
      return null;
    }
    cachedThesis = t;
    return t;
  } catch {
    return null;
  }
}

export function saveRunningThesis(
  t: RunningThesis,
  path: string = defaultThesisPath(),
): RunningThesis {
  const normalized: RunningThesis = {
    bias: t.bias,
    marketFocus: t.marketFocus.map((s) => s.toLowerCase()),
    timeHorizon: t.timeHorizon,
    convictionMin: Math.max(1, Math.min(10, Math.round(t.convictionMin))),
    note: t.note,
    declaredAt: t.declaredAt || new Date().toISOString(),
    expiresAt: t.expiresAt,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(normalized, null, 2), "utf8");
  cachedThesis = normalized;
  return normalized;
}

export function clearRunningThesis(
  path: string = defaultThesisPath(),
): void {
  cachedThesis = null;
  if (existsSync(path)) {
    writeFileSync(path, "", "utf8");
  }
}

export function _resetThesisCacheForTest(): void {
  cachedThesis = null;
}

export interface PlanShape {
  direction: "long" | "short";
  assetClass?: string;
  timeHorizon?: ThesisHorizon;
  /** 1-10 */
  conviction?: number;
}

export interface CoherenceScore {
  /** 0-1 where 1 = perfectly aligned. */
  score: number;
  reasons: string[];
  failures: string[];
}

export function scoreCoherence(
  plan: PlanShape,
  thesis: RunningThesis,
): CoherenceScore {
  const reasons: string[] = [];
  const failures: string[] = [];
  let achieved = 0;
  let total = 0;

  // Direction (weight 3 — most important)
  total += 3;
  if (thesis.bias === "neutral") {
    achieved += 3;
    reasons.push("thesis is neutral, any direction allowed");
  } else if (
    (thesis.bias === "long" && plan.direction === "long") ||
    (thesis.bias === "short" && plan.direction === "short")
  ) {
    achieved += 3;
    reasons.push(`direction ${plan.direction} matches thesis bias ${thesis.bias}`);
  } else {
    failures.push(`direction ${plan.direction} contradicts thesis bias ${thesis.bias}`);
  }

  if (plan.assetClass) {
    total += 2;
    if (thesis.marketFocus.length === 0 || thesis.marketFocus.includes(plan.assetClass.toLowerCase())) {
      achieved += 2;
      reasons.push(`asset class ${plan.assetClass} within thesis focus`);
    } else {
      failures.push(
        `asset class ${plan.assetClass} outside thesis focus [${thesis.marketFocus.join(", ")}]`,
      );
    }
  }

  if (plan.timeHorizon) {
    total += 1;
    if (plan.timeHorizon === thesis.timeHorizon) {
      achieved += 1;
      reasons.push(`time horizon ${plan.timeHorizon} matches thesis`);
    } else {
      failures.push(
        `time horizon ${plan.timeHorizon} differs from thesis ${thesis.timeHorizon}`,
      );
    }
  }

  if (plan.conviction !== undefined) {
    total += 1;
    if (plan.conviction >= thesis.convictionMin) {
      achieved += 1;
      reasons.push(`conviction ${plan.conviction} meets thesis floor ${thesis.convictionMin}`);
    } else {
      failures.push(
        `conviction ${plan.conviction} below thesis floor ${thesis.convictionMin}`,
      );
    }
  }

  return {
    score: total === 0 ? 1 : achieved / total,
    reasons,
    failures,
  };
}

export interface CoherenceGateResult {
  ok: boolean;
  score: number;
  threshold: number;
  failures: string[];
  reason?: string;
}

export function gateCoherence(
  plan: PlanShape,
  env: NodeJS.ProcessEnv = process.env,
  thesis: RunningThesis | null = loadRunningThesis(),
): CoherenceGateResult {
  if (!isCoherenceEnabled(env)) {
    return { ok: true, score: 1, threshold: 0, failures: [] };
  }
  const threshold = getCoherenceThreshold(env);
  if (!thesis) {
    return {
      ok: false,
      score: 0,
      threshold,
      failures: ["no running thesis declared"],
      reason:
        "GORDON_THESIS_COHERENCE is enabled but no running thesis is declared. " +
        "The trader must declare a thesis via set_running_thesis before plans can be executed. " +
        "Anti-portfolio-rot guard: every plan must align with an explicit running thesis.",
    };
  }
  const score = scoreCoherence(plan, thesis);
  if (score.score >= threshold) {
    return { ok: true, score: score.score, threshold, failures: score.failures };
  }
  return {
    ok: false,
    score: score.score,
    threshold,
    failures: score.failures,
    reason:
      `Plan coherence with running thesis is ${score.score.toFixed(2)} (threshold: ${threshold.toFixed(2)}). ` +
      `Failures: ${score.failures.join("; ")}. ` +
      `Anti-portfolio-rot guard: either revise the plan to fit the running thesis, ` +
      `or explicitly update the thesis via set_running_thesis if your edge has changed.`,
  };
}
