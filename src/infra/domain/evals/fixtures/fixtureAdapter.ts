/**
 * Fixture adapter — bridges the dry-run producer's output (ScenarioLiveResult:
 * EvalTrajectory + NormalizedTrace) into the two shapes the eval gate
 * (`scripts/dev/eval/eval-gate.ts`) consumes:
 *   - AuditTrace[] for the gold-trace process-check leg, and
 *   - the trajectory-fixture file format for the LLM-judge regression leg.
 *
 * The dry-run producer emits a NormalizedTrace (flat tool-call sequence) but
 * the gold-trace leg scores AuditTrace via scoreTrace — this is the smallest
 * adapter between the two, validated through AuditTraceSchema so any shape
 * drift fails closed at generation time, never silently in CI.
 *
 * Deterministic on purpose: uuids and timestamps are derived from the
 * scenario id so regenerating fixtures produces stable diffs.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";

import {
  AuditTraceSchema,
  type AuditTrace,
  type AuditToolCall,
} from "../../../../core/audit/types.ts";
import type { EvalScenario, EvalTrajectory } from "../harness/types.ts";
import type { ScenarioLiveResult } from "../harness/live/runner.ts";

export const FIXTURE_FORMAT_VERSION = 1;

/** Variant label stamped on every committed dry-run baseline trajectory. */
export const FIXTURE_VARIANT_LABEL = "dry-run-baseline";

/** Fixed timestamp inside generated traces — keeps regeneration diffs stable. */
export const FIXTURE_TIMESTAMP = "2026-01-01T00:00:00.000Z";

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));

/** Committed baseline trajectory fixture (LLM-judge regression leg input). */
export const BASELINE_TRAJECTORIES_FIXTURE_PATH = join(
  FIXTURES_DIR,
  "baseline-trajectories.json",
);

/** Committed gold-trace fixture (deterministic process-check leg input). */
export const GOLD_TRACES_FIXTURE_PATH = join(FIXTURES_DIR, "gold-traces.json");

/** Deterministic per-scenario thread id, shared by generator and drift tests. */
export function fixtureThreadId(scenarioId: string): string {
  return `eval-fixture-${scenarioId}`;
}

function fnv1a(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * RFC-4122 v4-shaped uuid derived purely from the seed string, so the same
 * scenario always regenerates the same trace_id (stable fixture diffs).
 */
export function deterministicUuid(seed: string): string {
  const hex = [0x811c9dc5, 0x01000193, 0xdeadbeef, 0x9e3779b9]
    .map((s) => fnv1a(seed, s).toString(16).padStart(8, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface FixtureProvenance {
  generatedAt: string;
  generatedBy: string;
  /** How trajectories were produced (dry-run, no LLM). */
  producer: string;
  scenarioCount: number;
}

export interface TrajectoryFixtureFile {
  formatVersion: number;
  provenance: FixtureProvenance;
  variantLabel: string;
  trajectories: Array<{ scenarioId: string } & EvalTrajectory>;
}

export interface GoldTraceEntry {
  scenarioId: string;
  trace: AuditTrace;
}

export interface GoldTraceFixtureFile {
  formatVersion: number;
  provenance: FixtureProvenance;
  traces: GoldTraceEntry[];
}

/**
 * Convert one dry-run producer result into a schema-valid AuditTrace.
 * Throws (fail closed) when the synthesized shape no longer satisfies
 * AuditTraceSchema — e.g. the producer starts emitting an outcome type
 * the audit enum doesn't know.
 */
export function dryRunResultToAuditTrace(
  scenario: EvalScenario,
  result: ScenarioLiveResult,
): AuditTrace {
  const toolCalls: AuditToolCall[] = [...result.normalized.toolCalls]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({
      tool_name: c.name,
      input_summary: c.inputSummary ?? "[dry-run fixture]",
      output_summary: c.outputSummary ?? "[dry-run fixture]",
      duration_ms: 0,
      success: c.ok,
    }));

  const assistant = result.trajectory.messages.find((m) => m.role === "assistant");

  return AuditTraceSchema.parse({
    trace_id: deterministicUuid(`trace:${scenario.id}`),
    trigger: {
      type: "user_message",
      event_type: `eval.fixture:${scenario.id}`,
      source: "eval-dry-run-fixture",
      payload_summary: scenario.userInput,
    },
    agent_steps: [
      {
        step_id: deterministicUuid(`step:${scenario.id}`),
        agent_id: result.normalized.agentId ?? "eval-dry-run",
        started_at: FIXTURE_TIMESTAMP,
        ended_at: FIXTURE_TIMESTAMP,
        reasoning_summary: assistant?.content ?? "[dry-run fixture]",
        tool_calls: toolCalls,
      },
    ],
    outcome: {
      type: result.normalized.outcomeType ?? "analysis_complete",
      details: `Dry-run fixture for scenario ${scenario.id} (derivedFrom: ${scenario.derivedFrom ?? "n/a"}).`,
    },
    started_at: FIXTURE_TIMESTAMP,
    ended_at: FIXTURE_TIMESTAMP,
    duration_ms: 0,
    ...(result.normalized.riskCheckId !== undefined && {
      risk_check_id: result.normalized.riskCheckId,
    }),
  });
}

// Parsers (fail closed on malformed input) -----------------------------------

const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const TrajectoryEntrySchema = z.object({
  scenarioId: z.string().min(1),
  id: z.string().min(1),
  messages: z.array(MessageSchema).min(1),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const TrajectoryFixtureFileSchema = z.object({
  formatVersion: z.literal(FIXTURE_FORMAT_VERSION),
  provenance: z.object({
    generatedAt: z.string(),
    generatedBy: z.string(),
    producer: z.string(),
    scenarioCount: z.number(),
  }),
  variantLabel: z.string().min(1),
  trajectories: z.array(TrajectoryEntrySchema).min(1),
});

const GoldTraceFixtureFileSchema = z.object({
  formatVersion: z.literal(FIXTURE_FORMAT_VERSION),
  provenance: z.object({
    generatedAt: z.string(),
    generatedBy: z.string(),
    producer: z.string(),
    scenarioCount: z.number(),
  }),
  traces: z.array(z.object({ scenarioId: z.string().min(1), trace: AuditTraceSchema })).min(1),
});

/** Parse + validate a trajectory fixture file (baseline or candidate). Throws on malformed input. */
export function parseTrajectoryFixture(raw: unknown): TrajectoryFixtureFile {
  return TrajectoryFixtureFileSchema.parse(raw);
}

export interface ParsedGoldTraces {
  traces: AuditTrace[];
  /** Present only for the committed fixture format (used for coverage checks). */
  scenarioIds?: string[];
}

/**
 * Parse a gold-trace file. Accepts both the committed fixture format and a
 * bare AuditTrace[] (operator-supplied paper-mode captures). Throws on
 * anything else — a misconfigured gold path must fail the gate, not skip it.
 */
export function parseGoldTraces(raw: unknown): ParsedGoldTraces {
  if (Array.isArray(raw)) {
    return { traces: z.array(AuditTraceSchema).min(1).parse(raw) };
  }
  const file = GoldTraceFixtureFileSchema.parse(raw);
  return {
    traces: file.traces.map((t) => t.trace),
    scenarioIds: file.traces.map((t) => t.scenarioId),
  };
}
