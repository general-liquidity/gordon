/**
 * Friction tracker (GORDON_FRICTION_TRACKER).
 *
 * Port of Ch 6 (Operator's Equation) + Ch 16 Protocol 3 (Monthly Risk
 * Audit / Leakage section) from Ryan Wright. Three components of friction
 * a strategy must overcome before any edge survives to the equity curve:
 *
 *   - explicit: commission, exchange fees, platform fees
 *   - implicit: slippage (planned vs actual fill), market impact
 *   - psychological: hesitation, premature exits, moved stops
 *
 * Wright's diagnostic from Protocol 3: if total friction exceeds 20% of
 * gross profit, the strategy has a problem — either trade less frequently
 * or improve execution. This module records typed events, persists them
 * as JSONL at ~/.gordon/friction.jsonl, and produces a monthly audit
 * with the verdict.
 *
 * Distinct from `marketImpact.ts` (Q3 — model that ESTIMATES slippage +
 * impact for a hypothetical fill). This module captures REALIZED friction
 * after the fill and aggregates across components — including the half
 * marketImpact can't see (the psychological column).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const FRICTION_TRACKER_PATH_ENV = "GORDON_FRICTION_TRACKER_PATH";

export function defaultFrictionLogPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env[FRICTION_TRACKER_PATH_ENV] || join(homedir(), ".gordon", "friction.jsonl");
}

export type FrictionComponent = "explicit" | "implicit" | "psychological";

export type FrictionKind =
  | "commission"
  | "exchange_fee"
  | "platform_fee"
  | "slippage"
  | "market_impact"
  | "hesitation"
  | "premature_exit"
  | "moved_stop"
  | "error";

const KIND_TO_COMPONENT: Record<FrictionKind, FrictionComponent> = {
  commission: "explicit",
  exchange_fee: "explicit",
  platform_fee: "explicit",
  slippage: "implicit",
  market_impact: "implicit",
  hesitation: "psychological",
  premature_exit: "psychological",
  moved_stop: "psychological",
  error: "psychological",
};

export interface FrictionEvent {
  id: string;
  recordedAt: string; // ISO
  tradeId: string;
  kind: FrictionKind;
  component: FrictionComponent;
  costUsd: number;
  meta?: Record<string, unknown>;
}

export interface RecordFrictionInput {
  tradeId: string;
  kind: FrictionKind;
  costUsd: number;
  meta?: Record<string, unknown>;
  /** Override recording timestamp (for tests / replay). */
  now?: string;
}

function newFrictionId(): string {
  return `fric-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function recordFriction(
  input: RecordFrictionInput,
  env: NodeJS.ProcessEnv = process.env,
  path: string = defaultFrictionLogPath(env),
): FrictionEvent | null {
  const event: FrictionEvent = {
    id: newFrictionId(),
    recordedAt: input.now ?? new Date().toISOString(),
    tradeId: input.tradeId,
    kind: input.kind,
    component: KIND_TO_COMPONENT[input.kind],
    costUsd: input.costUsd,
    meta: input.meta,
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(event) + "\n", "utf8");
  } catch {
    /* best-effort */
  }
  return event;
}

export function readFrictionLog(path: string): FrictionEvent[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const events: FrictionEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as FrictionEvent);
    } catch {
      /* skip malformed line */
    }
  }
  return events;
}

export type FrictionVerdict = "ok" | "warn" | "fail";

export interface FrictionAudit {
  windowStart: string;
  windowEnd: string;
  byComponent: Record<FrictionComponent, number>;
  byKind: Partial<Record<FrictionKind, number>>;
  total: number;
  grossProfitUsd: number;
  netProfitUsd: number;
  frictionRatio: number; // total / max(grossProfitUsd, ε)
  verdict: FrictionVerdict;
  eventCount: number;
}

export interface AuditInput {
  events: ReadonlyArray<FrictionEvent>;
  windowStart: string;
  windowEnd: string;
  /** Gross profit before friction in the window. */
  grossProfitUsd: number;
  /**
   * Threshold above which Wright calls the strategy broken. Default 20%
   * per Ch 16 Protocol 3. Warn at half that.
   */
  failRatio?: number;
}

const DEFAULT_FAIL_RATIO = 0.20;

export function auditFriction(input: AuditInput): FrictionAudit {
  const failRatio = input.failRatio ?? DEFAULT_FAIL_RATIO;
  const warnRatio = failRatio / 2;

  const start = Date.parse(input.windowStart);
  const end = Date.parse(input.windowEnd);

  const byComponent: Record<FrictionComponent, number> = {
    explicit: 0,
    implicit: 0,
    psychological: 0,
  };
  const byKind: Partial<Record<FrictionKind, number>> = {};
  let total = 0;
  let count = 0;

  for (const e of input.events) {
    const t = Date.parse(e.recordedAt);
    if (Number.isFinite(start) && t < start) continue;
    if (Number.isFinite(end) && t > end) continue;
    byComponent[e.component] += e.costUsd;
    byKind[e.kind] = (byKind[e.kind] ?? 0) + e.costUsd;
    total += e.costUsd;
    count += 1;
  }

  const denom = input.grossProfitUsd > 0 ? input.grossProfitUsd : 1;
  const ratio = total / denom;

  let verdict: FrictionVerdict = "ok";
  if (input.grossProfitUsd <= 0 && total > 0) {
    verdict = "fail";
  } else if (ratio >= failRatio) {
    verdict = "fail";
  } else if (ratio >= warnRatio) {
    verdict = "warn";
  }

  return {
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    byComponent,
    byKind,
    total,
    grossProfitUsd: input.grossProfitUsd,
    netProfitUsd: input.grossProfitUsd - total,
    frictionRatio: ratio,
    verdict,
    eventCount: count,
  };
}

export function formatAudit(audit: FrictionAudit): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const $ = (n: number) => `$${n.toFixed(2)}`;
  const lines: string[] = [];
  lines.push(
    `Friction audit ${audit.windowStart.slice(0, 10)} → ${audit.windowEnd.slice(0, 10)} (${audit.verdict.toUpperCase()})`,
  );
  lines.push(
    `  Total: ${$(audit.total)} (${pct(audit.frictionRatio)} of gross ${$(audit.grossProfitUsd)})`,
  );
  lines.push(
    `  Net:   ${$(audit.netProfitUsd)} | events: ${audit.eventCount}`,
  );
  lines.push(
    `  By component:  explicit ${$(audit.byComponent.explicit)} | implicit ${$(audit.byComponent.implicit)} | psychological ${$(audit.byComponent.psychological)}`,
  );
  return lines.join("\n");
}

export function auditToPayload(audit: FrictionAudit): Record<string, unknown> {
  return {
    kind: "friction_tracker.audited",
    total: Number(audit.total.toFixed(2)),
    grossProfit: Number(audit.grossProfitUsd.toFixed(2)),
    netProfit: Number(audit.netProfitUsd.toFixed(2)),
    frictionRatio: Number(audit.frictionRatio.toFixed(4)),
    verdict: audit.verdict,
    byComponent: audit.byComponent,
    eventCount: audit.eventCount,
  };
}
