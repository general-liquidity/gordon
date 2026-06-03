/**
 * Trace scorer (Phase 1) — the online scorer for the production→eval loop.
 *
 * SOTA continuous-eval (Braintrust/LangSmith-class) samples production traces,
 * scores them, and auto-curates failures into the eval dataset. Gordon's
 * highest-signal online scorer is deterministic and free: the process checks
 * over the audit trace's tool-call sequence (did it skip the risk gate? move
 * funds without approval?). An optional LLM rubric score can layer on top, but
 * the deterministic safety checks are the star — they catch the failures that
 * actually matter for a money agent.
 *
 * Flagged traces are appended to the promotion queue (silver) for operator
 * triage → promoteTraceToScenario (gold).
 */

import type { AuditTrace } from "../../../../../core/audit/types.ts";
import { checkTrajectory } from "../process/processChecks.ts";
import type { ProcessCheckResult } from "../process/processChecks.ts";
import { auditTraceToNormalized } from "./traceAdapter.ts";
import {
  appendToPromotionQueue,
  defaultPromotionQueuePath,
  type PromotionEntry,
} from "./promotionQueue.ts";

export interface TraceScore {
  traceId: string;
  processResult: ProcessCheckResult;
  /** True when the trace has any block violation (warns alone don't flag). */
  flagged: boolean;
  reasons: string[];
}

/** Deterministic process score for a single trace. No LLM, no I/O. */
export function scoreTrace(trace: AuditTrace): TraceScore {
  const processResult = checkTrajectory(auditTraceToNormalized(trace));
  const blocks = processResult.violations.filter((v) => v.severity === "block");
  return {
    traceId: trace.trace_id,
    processResult,
    flagged: blocks.length > 0,
    reasons: processResult.violations.map((v) => `[${v.severity}] ${v.rule}: ${v.detail}`),
  };
}

/** Deterministic sample decision in [0,1) from a trace id (no Math.random). */
function sampleHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export interface ScoreTracesOptions {
  /** Fraction of traces to score, 0..1. Default 1 (score all). */
  sampleRate?: number;
  /** How many recent traces to consider. Default 100. */
  limit?: number;
  /** Inject the trace source (tests pass a fixture fn; default = audit store). */
  getTraces?: (limit: number) => AuditTrace[];
  /** When true, append flagged traces to the promotion queue. Default true. */
  promote?: boolean;
  /** Override the promotion-queue path. */
  promotionPath?: string;
}

export interface ScoreTracesResult {
  scored: TraceScore[];
  flagged: TraceScore[];
  /** Number of flagged traces appended to the promotion queue. */
  promoted: number;
}

function defaultGetTraces(limit: number): AuditTrace[] {
  // Lazy import keeps the audit store (and its DB deps) off the hot path and
  // out of tests that inject their own fixtures.
  const { getRecentTraces } = require("../../../../../core/audit/store.ts") as {
    getRecentTraces: (n: number) => AuditTrace[];
  };
  return getRecentTraces(limit);
}

/**
 * Sample recent traces, run process checks, and (optionally) append flagged
 * ones to the promotion queue for triage. Returns the full scored set.
 */
export function scoreRecentTraces(opts: ScoreTracesOptions = {}): ScoreTracesResult {
  const sampleRate = opts.sampleRate ?? 1;
  const limit = opts.limit ?? 100;
  const getTraces = opts.getTraces ?? defaultGetTraces;
  const promote = opts.promote ?? true;

  const traces = getTraces(limit).filter((t) => sampleHash(t.trace_id) < sampleRate);
  const scored = traces.map(scoreTrace);
  const flagged = scored.filter((s) => s.flagged);

  let promoted = 0;
  if (promote && flagged.length > 0) {
    const entries: PromotionEntry[] = flagged.map((s) => {
      const worst = s.processResult.violations.some((v) => v.severity === "block")
        ? "block"
        : "warn";
      return {
        traceId: s.traceId,
        derivedFrom: `trace:${s.traceId}`,
        severity: worst,
        reason: s.reasons[0] ?? "process-check violation",
        violations: s.processResult.violations,
      };
    });
    const res = appendToPromotionQueue(entries, opts.promotionPath ?? defaultPromotionQueuePath());
    promoted = res.written;
  }

  return { scored, flagged, promoted };
}
