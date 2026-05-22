/**
 * Skill Governance — staleness + status diagnostics for the operator.
 *
 * Inspired by Mang Group's institutional skill-governance pattern
 * (Tashara Fernando's talk): skills are production assets, not
 * scratch scripts. At single-operator scale this surface helps the
 * operator track skill hygiene. At Pro/institutional scale (see the
 * [[dual-edition-strategy]] memory entry) the same metadata is the
 * foundation for review queues, owner approvals, and managed-vs-
 * community tiering.
 *
 * This module is purely diagnostic. It does NOT:
 *   - block skills from loading (the loader already issues warnings
 *     for malformed governance metadata)
 *   - prevent invocation of stale skills (operator's call)
 *   - mutate skill files (operator backfills metadata manually as
 *     they review)
 */

import type { Skill, SkillStatus } from "./types.ts";

export type StalenessVerdict = "fresh" | "recent" | "stale" | "never_reviewed";

export interface SkillStalenessOptions {
  /** Days threshold below which review is "fresh". Default 30. */
  freshDays?: number;
  /** Days threshold below which review is "recent". Default 90. */
  recentDays?: number;
  /** Reference date (defaults to now — passed in for deterministic tests). */
  now?: Date;
}

export interface SkillStalenessResult {
  skillId: string;
  lastReviewed: string | null;
  daysSinceReview: number | null;
  verdict: StalenessVerdict;
}

export interface SkillStatusBreakdown {
  active: number;
  experimental: number;
  deprecated: number;
  unspecified: number;
  total: number;
}

const DEFAULT_FRESH_DAYS = 30;
const DEFAULT_RECENT_DAYS = 90;

/**
 * Returns the lifecycle status of a skill. Defaults to "experimental"
 * when not set — surfaces unreviewed skills in audit reports.
 */
export function skillStatus(skill: Skill): SkillStatus {
  return skill.frontmatter.status ?? "experimental";
}

/**
 * Compute staleness verdict for a single skill. Operates on the
 * `lastReviewed` ISO date; returns `never_reviewed` when absent
 * (cleaner than treating unreviewed and forever-stale identically).
 */
export function assessSkillStaleness(
  skill: Skill,
  options: SkillStalenessOptions = {},
): SkillStalenessResult {
  const freshDays = options.freshDays ?? DEFAULT_FRESH_DAYS;
  const recentDays = options.recentDays ?? DEFAULT_RECENT_DAYS;
  const now = options.now ?? new Date();

  const lastReviewed = skill.frontmatter.lastReviewed ?? null;
  if (!lastReviewed) {
    return {
      skillId: skill.id,
      lastReviewed: null,
      daysSinceReview: null,
      verdict: "never_reviewed",
    };
  }

  const reviewDate = new Date(lastReviewed);
  if (Number.isNaN(reviewDate.getTime())) {
    return {
      skillId: skill.id,
      lastReviewed,
      daysSinceReview: null,
      verdict: "never_reviewed",
    };
  }

  const msSinceReview = now.getTime() - reviewDate.getTime();
  const daysSinceReview = Math.floor(msSinceReview / (1000 * 60 * 60 * 24));

  let verdict: StalenessVerdict;
  if (daysSinceReview <= freshDays) verdict = "fresh";
  else if (daysSinceReview <= recentDays) verdict = "recent";
  else verdict = "stale";

  return {
    skillId: skill.id,
    lastReviewed,
    daysSinceReview,
    verdict,
  };
}

/**
 * Aggregate skill counts by status. Skills without a `status` field
 * are counted as "unspecified" (separately from `experimental`) so
 * the operator can distinguish "I deliberately marked this
 * experimental" from "I forgot to set status".
 */
export function summarizeSkillStatuses(skills: Skill[]): SkillStatusBreakdown {
  const breakdown: SkillStatusBreakdown = {
    active: 0,
    experimental: 0,
    deprecated: 0,
    unspecified: 0,
    total: skills.length,
  };
  for (const skill of skills) {
    const status = skill.frontmatter.status;
    if (status === "active") breakdown.active++;
    else if (status === "experimental") breakdown.experimental++;
    else if (status === "deprecated") breakdown.deprecated++;
    else breakdown.unspecified++;
  }
  return breakdown;
}

/**
 * Filter skills to those needing operator review — skills whose
 * staleness verdict is `stale` or `never_reviewed`. Sorted by
 * daysSinceReview descending (most stale first); never-reviewed
 * skills sort to the end.
 */
export function skillsNeedingReview(
  skills: Skill[],
  options: SkillStalenessOptions = {},
): SkillStalenessResult[] {
  const results: SkillStalenessResult[] = [];
  for (const skill of skills) {
    const staleness = assessSkillStaleness(skill, options);
    if (staleness.verdict === "stale" || staleness.verdict === "never_reviewed") {
      results.push(staleness);
    }
  }
  results.sort((a, b) => {
    if (a.daysSinceReview === null && b.daysSinceReview === null) return 0;
    if (a.daysSinceReview === null) return 1;
    if (b.daysSinceReview === null) return -1;
    return b.daysSinceReview - a.daysSinceReview;
  });
  return results;
}
