/**
 * Mutation Rejection — "don't repeat failed approaches" for the genome loop.
 *
 * Ported from SIA (Hebbar et al. 2026), which feeds the feedback agent the
 * full evolution history so it doesn't re-try mutations that already failed.
 * Gordon's genome lineage ALREADY records every genome's `mutations_from_parent`
 * + `fitness_score`, so the failed-mutation set can be DERIVED from existing
 * data — no new persistence needed. This mirrors ACE's RejectedBuffer (which
 * does the same for prompt-level lessons) one layer down, at the strategy
 * genome level.
 *
 * The rule: pair each genome with its parent (by parent_genome_id); when the
 * child's composite fitness is materially below the parent's, the mutations
 * that created the child are evidence AGAINST that (field_path, direction).
 * Evidence is aggregated NET across the whole population — a mutation that
 * helped more often than it hurt is not rejected, so one unlucky branch can't
 * permanently block exploration.
 *
 * Pure functions. No I/O, no Date.now, no env reads (callers pass the
 * threshold). Deterministic given its inputs.
 */

import type { Genome, Mutation } from "./types.ts";

/** Direction of a parameter change — the axis a rejection is keyed on. */
export type MutationDirection = "up" | "down" | "swap" | "add" | "remove" | "change";

export interface RejectedMutation {
  /** Dot-path the rejection applies to. */
  fieldPath: string;
  /** Direction that regressed fitness. */
  direction: MutationDirection;
  /** Net composite-fitness drop across all observations (parent − child, summed).
   *  Positive = net regressive. */
  netFitnessDrop: number;
  /** How many parent→child observations contributed to this key. */
  observations: number;
  /** Genome id of the single worst regression for this key (for the message). */
  worstGenomeId: string;
  /** Human-readable explanation. */
  reason: string;
}

/** Default net-fitness-drop (composite points) above which a (field,direction)
 *  is considered a failed approach. */
export const DEFAULT_MIN_FITNESS_DROP = 1.0;

/** Derive the direction axis a mutation moves along. */
export function mutationDirection(m: Mutation): MutationDirection {
  switch (m.mutation_type) {
    case "swap":
      return "swap";
    case "add":
      return "add";
    case "remove":
      return "remove";
    default:
      break; // nudge / shift → numeric direction below
  }
  const from = m.from_value;
  const to = m.to_value;
  if (typeof from === "number" && typeof to === "number") {
    if (to > from) return "up";
    if (to < from) return "down";
    return "change";
  }
  return "change";
}

/** Stable key for a (field_path, direction) pair. */
export function rejectionKey(fieldPath: string, direction: MutationDirection): string {
  return `${fieldPath}::${direction}`;
}

interface Aggregate {
  fieldPath: string;
  direction: MutationDirection;
  netDrop: number;
  observations: number;
  worstDrop: number;
  worstGenomeId: string;
  parameterName: string;
}

/**
 * Derive the net-regressive mutation set from a playbook's genome population.
 * Returns one entry per (field_path, direction) whose summed parent→child
 * fitness delta is net-regressive beyond `minFitnessDrop`.
 */
export function deriveRejectedMutations(
  genomes: ReadonlyArray<Genome>,
  opts: { minFitnessDrop?: number } = {},
): RejectedMutation[] {
  const minDrop = opts.minFitnessDrop ?? DEFAULT_MIN_FITNESS_DROP;
  const byId = new Map<string, Genome>();
  for (const g of genomes) byId.set(g.genome_id, g);

  const agg = new Map<string, Aggregate>();

  for (const child of genomes) {
    if (!child.parent_genome_id) continue;
    const parent = byId.get(child.parent_genome_id);
    if (!parent) continue;
    if (typeof child.fitness_score !== "number" || typeof parent.fitness_score !== "number")
      continue;

    // Positive drop = the child regressed relative to its parent.
    const drop = parent.fitness_score - child.fitness_score;

    for (const m of child.mutations_from_parent) {
      const direction = mutationDirection(m);
      const key = rejectionKey(m.field_path, direction);
      const existing = agg.get(key);
      if (existing) {
        existing.netDrop += drop;
        existing.observations += 1;
        if (drop > existing.worstDrop) {
          existing.worstDrop = drop;
          existing.worstGenomeId = child.genome_id;
          existing.parameterName = m.parameter_name;
        }
      } else {
        agg.set(key, {
          fieldPath: m.field_path,
          direction,
          netDrop: drop,
          observations: 1,
          worstDrop: drop,
          worstGenomeId: child.genome_id,
          parameterName: m.parameter_name,
        });
      }
    }
  }

  const rejections: RejectedMutation[] = [];
  for (const a of agg.values()) {
    if (a.netDrop < minDrop) continue;
    rejections.push({
      fieldPath: a.fieldPath,
      direction: a.direction,
      netFitnessDrop: a.netDrop,
      observations: a.observations,
      worstGenomeId: a.worstGenomeId,
      reason:
        `${a.parameterName} (${a.direction}) is net-regressive: ` +
        `${a.netDrop.toFixed(1)} pts lost across ${a.observations} fork(s); ` +
        `worst in genome ${a.worstGenomeId.slice(0, 8)}.`,
    });
  }
  // Largest net drop first — most-failed approaches at the top.
  rejections.sort((x, y) => y.netFitnessDrop - x.netFitnessDrop);
  return rejections;
}

/** Return the matching rejection for a candidate mutation, or null. */
export function matchRejection(
  candidate: Mutation,
  rejections: ReadonlyArray<RejectedMutation>,
): RejectedMutation | null {
  const dir = mutationDirection(candidate);
  for (const r of rejections) {
    if (r.fieldPath === candidate.field_path && r.direction === dir) return r;
  }
  return null;
}

export interface FilterResult {
  kept: Mutation[];
  suppressed: Array<{ mutation: Mutation; rejection: RejectedMutation }>;
}

/** Split candidate mutations into kept vs suppressed against a rejection set. */
export function filterRejectedMutations(
  candidates: ReadonlyArray<Mutation>,
  rejections: ReadonlyArray<RejectedMutation>,
): FilterResult {
  const kept: Mutation[] = [];
  const suppressed: Array<{ mutation: Mutation; rejection: RejectedMutation }> = [];
  for (const c of candidates) {
    const r = matchRejection(c, rejections);
    if (r) suppressed.push({ mutation: c, rejection: r });
    else kept.push(c);
  }
  return { kept, suppressed };
}
