/**
 * Quality Document (GORDON_QUALITY_DOC).
 *
 * Port of the "quality document" pattern from hands-on harness engineering
 * Module 11. A recurring snapshot scoring the codebase across the five
 * harness layers. Trend over time is the actual product — single snapshots
 * are anecdotal, the multi-session trajectory is the signal.
 *
 * Five layers mapped to Gordon:
 *   - Instructions: CLAUDE.md + skills + mandate completeness
 *   - Tools: tool inventory + permission boundaries + offload limits
 *   - Environment: Bun + provider health + flag posture
 *   - State: action-log + working/cold memory + decision log
 *   - Feedback: riskClassifier + doom-loop + critique + termination layers
 *
 * Each layer scores 0-2 (matches planRubric.ts cadence):
 *   0 = missing or broken
 *   1 = present but incomplete
 *   2 = robust
 *
 * Snapshots persist as JSONL at `~/.gordon/quality-snapshots.jsonl`.
 * Trend helpers compute deltas between snapshots.
 *
 * This module does NOT auto-score. Callers (a `/quality` slash command,
 * the eval harness, a setup-runtime hook) build a snapshot via
 * `createQualitySnapshot(input)` after collecting the inputs themselves.
 * Keeping scoring separate from collection lets the same scorer run in
 * different contexts (CI, ad-hoc audit, post-session checkpoint).
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const QUALITY_FLAG_ENV = "GORDON_QUALITY_DOC";
export const QUALITY_PATH_ENV = "GORDON_QUALITY_SNAPSHOTS_PATH";

export type QualityScore = 0 | 1 | 2;
export type QualityLayer = "instructions" | "tools" | "environment" | "state" | "feedback";

export const QUALITY_LAYERS: readonly QualityLayer[] = [
  "instructions",
  "tools",
  "environment",
  "state",
  "feedback",
] as const;

export interface LayerScore {
  layer: QualityLayer;
  score: QualityScore;
  /** One-sentence justification. Required — a score without a reason is noise. */
  rationale: string;
}

export interface QualitySnapshot {
  /** ISO timestamp. */
  capturedAt: string;
  /** Free-form label so the operator can correlate with a build/branch/session. */
  label: string;
  /** All five layer scores; order matches QUALITY_LAYERS. */
  scores: LayerScore[];
  /** Total 0-10. Helper to avoid re-summing in consumers. */
  total: number;
  /** Lowest-scoring layer name (or layers when tied). */
  weakestLayers: QualityLayer[];
}

export interface QualitySnapshotInput {
  label: string;
  instructions: { score: QualityScore; rationale: string };
  tools: { score: QualityScore; rationale: string };
  environment: { score: QualityScore; rationale: string };
  state: { score: QualityScore; rationale: string };
  feedback: { score: QualityScore; rationale: string };
  /** Override for tests. Defaults to new Date().toISOString(). */
  now?: string;
}

export interface QualityTrend {
  previous: QualitySnapshot;
  current: QualitySnapshot;
  totalDelta: number;
  /** Per-layer delta. Positive = improved. */
  perLayerDelta: Record<QualityLayer, number>;
  regressedLayers: QualityLayer[];
  improvedLayers: QualityLayer[];
}

export function isQualityDocEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[QUALITY_FLAG_ENV] === "1" || env[QUALITY_FLAG_ENV] === "true";
}

export function defaultQualitySnapshotsPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[QUALITY_PATH_ENV];
  if (override && override.length > 0) return override;
  return join(homedir(), ".gordon", "quality-snapshots.jsonl");
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function createQualitySnapshot(input: QualitySnapshotInput): QualitySnapshot {
  const scores: LayerScore[] = [
    { layer: "instructions", score: input.instructions.score, rationale: input.instructions.rationale },
    { layer: "tools", score: input.tools.score, rationale: input.tools.rationale },
    { layer: "environment", score: input.environment.score, rationale: input.environment.rationale },
    { layer: "state", score: input.state.score, rationale: input.state.rationale },
    { layer: "feedback", score: input.feedback.score, rationale: input.feedback.rationale },
  ];
  const total = scores.reduce((sum, s) => sum + s.score, 0);
  const min = Math.min(...scores.map((s) => s.score));
  const weakestLayers = scores.filter((s) => s.score === min).map((s) => s.layer);

  return {
    capturedAt: input.now ?? new Date().toISOString(),
    label: input.label,
    scores,
    total,
    weakestLayers,
  };
}

export function recordQualitySnapshot(snapshot: QualitySnapshot, path?: string): void {
  const target = path ?? defaultQualitySnapshotsPath();
  ensureParentDir(target);
  appendFileSync(target, JSON.stringify(snapshot) + "\n", "utf8");
}

export interface ReadSnapshotsOptions {
  /** Filter to label substring match. */
  labelContains?: string;
  /** Max snapshots returned, most-recent first. */
  limit?: number;
}

/**
 * Read snapshots. Tolerant of malformed lines.
 * Returns newest-first when sorted.
 */
export function readQualitySnapshots(
  opts: ReadSnapshotsOptions = {},
  path?: string,
): QualitySnapshot[] {
  const target = path ?? defaultQualitySnapshotsPath();
  if (!existsSync(target)) return [];

  const lines = readFileSync(target, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const snapshots: QualitySnapshot[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as QualitySnapshot;
      if (typeof parsed.capturedAt === "string" && Array.isArray(parsed.scores)) {
        snapshots.push(parsed);
      }
    } catch {
      // skip malformed
    }
  }

  let filtered = snapshots;
  if (opts.labelContains) {
    const needle = opts.labelContains;
    filtered = filtered.filter((s) => s.label.includes(needle));
  }
  filtered.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  if (opts.limit !== undefined) filtered = filtered.slice(0, opts.limit);
  return filtered;
}

export function computeTrend(previous: QualitySnapshot, current: QualitySnapshot): QualityTrend {
  const perLayerDelta = {} as Record<QualityLayer, number>;
  for (const layer of QUALITY_LAYERS) {
    const prev = previous.scores.find((s) => s.layer === layer)?.score ?? 0;
    const curr = current.scores.find((s) => s.layer === layer)?.score ?? 0;
    perLayerDelta[layer] = curr - prev;
  }
  const regressedLayers = QUALITY_LAYERS.filter((l) => perLayerDelta[l] < 0);
  const improvedLayers = QUALITY_LAYERS.filter((l) => perLayerDelta[l] > 0);

  return {
    previous,
    current,
    totalDelta: current.total - previous.total,
    perLayerDelta,
    regressedLayers,
    improvedLayers,
  };
}

/**
 * Compute trend across the most recent N snapshots (newest first).
 * Returns adjacent-pair trends so callers can render a sparkline.
 */
export function computeTrendSeries(snapshots: QualitySnapshot[]): QualityTrend[] {
  if (snapshots.length < 2) return [];
  const ordered = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const trends: QualityTrend[] = [];
  for (let i = 1; i < ordered.length; i++) {
    trends.push(computeTrend(ordered[i - 1]!, ordered[i]!));
  }
  return trends;
}

export function formatQualitySnapshot(snapshot: QualitySnapshot): string {
  const lines: string[] = [];
  lines.push(`Quality snapshot — ${snapshot.label} (${snapshot.capturedAt})`);
  lines.push(`Total: ${snapshot.total}/10  Weakest: ${snapshot.weakestLayers.join(", ")}`);
  for (const s of snapshot.scores) {
    lines.push(`  ${s.layer.padEnd(13)} ${s.score}/2  ${s.rationale}`);
  }
  return lines.join("\n");
}

export function snapshotToPayload(snapshot: QualitySnapshot): Record<string, unknown> {
  return {
    kind: "quality.snapshot_recorded",
    capturedAt: snapshot.capturedAt,
    label: snapshot.label,
    total: snapshot.total,
    weakestLayers: snapshot.weakestLayers,
    scores: snapshot.scores,
  };
}
