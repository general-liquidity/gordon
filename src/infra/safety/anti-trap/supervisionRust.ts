/**
 * Supervision-rust calibration check.
 *
 * Periodically injects a deliberately-flawed plan; tracks whether the
 * user catches it. If they rubber-stamp the bad plan, the catch-rate
 * drops and a "rust detected" signal can be surfaced — the anti-atrophy
 * mechanism from Faye's coding-agent trap critique, mapped to trading.
 *
 * Storage: JSONL at ~/.gordon/supervision-rust.jsonl (override via
 * GORDON_SUPERVISION_RUST_PATH). Default injection rate is 0 (off);
 * set GORDON_SUPERVISION_RUST_RATE to a fraction in (0,1] to enable.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { flagEnv } from "../../config/flagResolver.ts";

export type FlawType =
  | "wrong_direction"
  | "excessive_size"
  | "missing_stop"
  | "inverted_rr"
  | "stale_data";

export interface SupervisionFlaw {
  flawId: string;
  type: FlawType;
  description: string;
  apply: (plan: Record<string, unknown>) => Record<string, unknown>;
}

export interface SupervisionRecord {
  flawId: string;
  flawType: FlawType;
  planId: string;
  injectedAt: string;
  userAccepted: boolean;
  decidedAt: string;
}

export const SUPERVISION_FLAWS: ReadonlyArray<SupervisionFlaw> = [
  {
    flawId: "wrong_direction",
    type: "wrong_direction",
    description: "Direction flipped relative to stated bias",
    apply: (plan) => ({
      ...plan,
      direction: plan.direction === "long" ? "short" : "long",
    }),
  },
  {
    flawId: "excessive_size",
    type: "excessive_size",
    description: "Position size set to 25% of portfolio (>5x normal max)",
    apply: (plan) => ({ ...plan, positionSizePct: 25 }),
  },
  {
    flawId: "missing_stop",
    type: "missing_stop",
    description: "Stop-loss removed from plan",
    apply: (plan) => {
      const copy = { ...plan };
      delete (copy as Record<string, unknown>).stopLoss;
      return copy;
    },
  },
  {
    flawId: "inverted_rr",
    type: "inverted_rr",
    description: "Stop is farther from entry than the first take-profit",
    apply: (plan) => {
      const entry = Number(plan.entry ?? 100);
      return {
        ...plan,
        entry,
        stopLoss: entry * 0.85,
        takeProfits: [entry * 1.02],
      };
    },
  },
  {
    flawId: "stale_data",
    type: "stale_data",
    description: "Plan based on price snapshot >2h old",
    apply: (plan) => ({
      ...plan,
      _stalenessHint: "Data fetched 2h17m ago — re-check before acting",
    }),
  },
];

export function defaultSupervisionLogPath(): string {
  const fromEnv = process.env.GORDON_SUPERVISION_RUST_PATH;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".gordon", "supervision-rust.jsonl");
}

export function getInjectionRate(env: NodeJS.ProcessEnv = flagEnv()): number {
  const raw = env.GORDON_SUPERVISION_RUST_RATE;
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0;
  return n;
}

export function shouldInjectFlaw(
  env: NodeJS.ProcessEnv = flagEnv(),
  rng: () => number = Math.random,
): boolean {
  const rate = getInjectionRate(env);
  return rate > 0 && rng() < rate;
}

export function pickFlaw(
  flaws: ReadonlyArray<SupervisionFlaw> = SUPERVISION_FLAWS,
  rng: () => number = Math.random,
): SupervisionFlaw {
  if (flaws.length === 0) {
    throw new Error("pickFlaw: flaws array is empty");
  }
  const idx = Math.min(Math.floor(rng() * flaws.length), flaws.length - 1);
  const flaw = flaws[idx];
  if (!flaw) {
    throw new Error("pickFlaw: unreachable — array index out of bounds");
  }
  return flaw;
}

export function injectFlaw(
  plan: Record<string, unknown>,
  flaw: SupervisionFlaw = pickFlaw(),
): { flawed: Record<string, unknown>; flawId: string; flawType: FlawType } {
  return { flawed: flaw.apply(plan), flawId: flaw.flawId, flawType: flaw.type };
}

export function newSupervisionRecord(
  flawId: string,
  flawType: FlawType,
  planId: string,
  userAccepted: boolean,
): SupervisionRecord {
  const now = new Date().toISOString();
  return {
    flawId,
    flawType,
    planId: planId || randomUUID(),
    injectedAt: now,
    userAccepted,
    decidedAt: now,
  };
}

export function recordSupervisionResult(
  rec: SupervisionRecord,
  path: string = defaultSupervisionLogPath(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(rec) + "\n", "utf8");
}

export interface SupervisionScore {
  total: number;
  caught: number;
  missed: number;
  catchRate: number;
}

export function readSupervisionScore(
  path: string = defaultSupervisionLogPath(),
): SupervisionScore {
  if (!existsSync(path)) {
    return { total: 0, caught: 0, missed: 0, catchRate: 1 };
  }
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  let caught = 0;
  let missed = 0;
  for (const line of lines) {
    try {
      const rec = JSON.parse(line) as SupervisionRecord;
      if (rec.userAccepted) missed++;
      else caught++;
    } catch {
      // skip malformed lines
    }
  }
  const total = caught + missed;
  const catchRate = total === 0 ? 1 : caught / total;
  return { total, caught, missed, catchRate };
}
