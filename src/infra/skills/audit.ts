/**
 * Skill Audit — operator-facing aggregate report combining metadata,
 * staleness, and usage statistics.
 *
 * `runSkillAudit()` produces a single structured object the
 * operator surface can render verbatim. Each piece is independently
 * tested in `governance.test.ts` / `usage-tracker.test.ts`; this
 * module just composes them.
 *
 * The "verdict" answers a simple operator question:
 *   - clean             — nothing demands action right now
 *   - needs_attention   — some skills are stale OR many are unspecified-status
 *   - degraded          — significant share of the catalog is stale + unused
 *
 * Thresholds are tunable; defaults match what the Mang Group talk
 * implied for a healthy library: clear ownership, recent review,
 * actual usage.
 */

import type { Skill } from "./types.ts";
import {
  assessSkillStaleness,
  skillsNeedingReview,
  summarizeSkillStatuses,
  type SkillStalenessOptions,
  type SkillStalenessResult,
  type SkillStatusBreakdown,
} from "./governance.ts";
import {
  getSkillUsageStats,
  neverInvokedSkills,
  type SkillUsageStats,
  type UsageReadOptions,
} from "./usage-tracker.ts";

export type AuditVerdict = "clean" | "needs_attention" | "degraded";

export interface SkillAuditReport {
  totalSkills: number;
  statusBreakdown: SkillStatusBreakdown;
  staleness: {
    fresh: number;
    recent: number;
    stale: number;
    neverReviewed: number;
  };
  /** Skills needing operator review (stale or never_reviewed), sorted oldest-first. */
  needsReview: SkillStalenessResult[];
  /** Per-skill usage stats, sorted by recent activity. */
  usage: SkillUsageStats[];
  /** Skill IDs that exist in the registry but have never been invoked. */
  neverInvoked: string[];
  /** Operator verdict — single-word summary of catalog health. */
  verdict: AuditVerdict;
  /** Human-readable summary. */
  summary: string;
}

export interface AuditOptions extends SkillStalenessOptions, UsageReadOptions {
  /**
   * Share of catalog that can be `stale` before verdict tilts to
   * `needs_attention`. Default 0.30.
   */
  needsAttentionStaleRatio?: number;
  /**
   * Share of catalog that can be `stale` before verdict tilts to
   * `degraded`. Default 0.50.
   */
  degradedStaleRatio?: number;
  /**
   * Share of catalog that can be never-invoked before factoring into
   * the verdict. Default 0.50.
   */
  degradedUnusedRatio?: number;
}

const DEFAULTS = {
  needsAttentionStaleRatio: 0.3,
  degradedStaleRatio: 0.5,
  degradedUnusedRatio: 0.5,
};

/**
 * Run the full skill audit. Pure function over the supplied skills
 * + persisted usage ledger.
 */
export function runSkillAudit(skills: Skill[], options: AuditOptions = {}): SkillAuditReport {
  const totalSkills = skills.length;
  const statusBreakdown = summarizeSkillStatuses(skills);

  const stalenessByVerdict = { fresh: 0, recent: 0, stale: 0, neverReviewed: 0 };
  for (const skill of skills) {
    const result = assessSkillStaleness(skill, options);
    if (result.verdict === "fresh") stalenessByVerdict.fresh++;
    else if (result.verdict === "recent") stalenessByVerdict.recent++;
    else if (result.verdict === "stale") stalenessByVerdict.stale++;
    else stalenessByVerdict.neverReviewed++;
  }

  const needsReview = skillsNeedingReview(skills, options);
  const usage = getSkillUsageStats(options);
  const allSkillIds = skills.map((s) => s.id);
  const neverInvoked = neverInvokedSkills(allSkillIds, options);

  // Verdict calculation
  const staleRatio = totalSkills === 0 ? 0 : stalenessByVerdict.stale / totalSkills;
  const unusedRatio = totalSkills === 0 ? 0 : neverInvoked.length / totalSkills;
  const needsAttentionStaleRatio =
    options.needsAttentionStaleRatio ?? DEFAULTS.needsAttentionStaleRatio;
  const degradedStaleRatio = options.degradedStaleRatio ?? DEFAULTS.degradedStaleRatio;
  const degradedUnusedRatio = options.degradedUnusedRatio ?? DEFAULTS.degradedUnusedRatio;

  let verdict: AuditVerdict;
  if (staleRatio >= degradedStaleRatio && unusedRatio >= degradedUnusedRatio) {
    verdict = "degraded";
  } else if (
    staleRatio >= needsAttentionStaleRatio ||
    statusBreakdown.unspecified > totalSkills * 0.5
  ) {
    verdict = "needs_attention";
  } else {
    verdict = "clean";
  }

  const summary =
    `${totalSkills} skills (${statusBreakdown.active} active, ${statusBreakdown.experimental} experimental, ` +
    `${statusBreakdown.deprecated} deprecated, ${statusBreakdown.unspecified} unspecified). ` +
    `Staleness: ${stalenessByVerdict.fresh} fresh / ${stalenessByVerdict.recent} recent / ` +
    `${stalenessByVerdict.stale} stale / ${stalenessByVerdict.neverReviewed} never reviewed. ` +
    `Usage: ${usage.length} skills invoked, ${neverInvoked.length} never invoked. ` +
    `Verdict: ${verdict}.`;

  return {
    totalSkills,
    statusBreakdown,
    staleness: stalenessByVerdict,
    needsReview,
    usage,
    neverInvoked,
    verdict,
    summary,
  };
}

/**
 * Render an operator-readable text audit. One-pass formatting; the
 * structured report is the source of truth, this is just for humans.
 */
export function formatAuditReport(report: SkillAuditReport): string {
  const lines: string[] = [
    `Gordon Skill Audit — ${report.totalSkills} skills — ${report.verdict.toUpperCase()}`,
    "",
    "Status Breakdown:",
    `  active:        ${report.statusBreakdown.active}`,
    `  experimental:  ${report.statusBreakdown.experimental}`,
    `  deprecated:    ${report.statusBreakdown.deprecated}`,
    `  unspecified:   ${report.statusBreakdown.unspecified}`,
    "",
    "Staleness (last review):",
    `  fresh (≤30d):       ${report.staleness.fresh}`,
    `  recent (≤90d):      ${report.staleness.recent}`,
    `  stale (>90d):       ${report.staleness.stale}`,
    `  never reviewed:     ${report.staleness.neverReviewed}`,
  ];

  if (report.needsReview.length > 0) {
    lines.push("", "Top candidates for review:");
    for (const item of report.needsReview.slice(0, 5)) {
      const age = item.daysSinceReview !== null ? `${item.daysSinceReview}d` : "never";
      lines.push(`  - ${item.skillId} (${age})`);
    }
  }

  if (report.usage.length > 0) {
    lines.push("", "Most-used (last 30d):");
    for (const stats of report.usage.slice(0, 5)) {
      lines.push(
        `  - ${stats.skillId}: ${stats.recentInvocations} recent / ${stats.totalInvocations} total`,
      );
    }
  }

  if (report.neverInvoked.length > 0) {
    lines.push("", `Never invoked (${report.neverInvoked.length} skills):`);
    for (const id of report.neverInvoked.slice(0, 5)) {
      lines.push(`  - ${id}`);
    }
    if (report.neverInvoked.length > 5) {
      lines.push(`  … and ${report.neverInvoked.length - 5} more`);
    }
  }

  return lines.join("\n");
}
