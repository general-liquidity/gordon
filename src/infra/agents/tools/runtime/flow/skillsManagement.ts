/**
 * Skills Management Tool — operator-facing surface for the skills
 * governance stack shipped in commit 32a5d5e8.
 *
 * One tool with a `subcommand` parameter that dispatches to:
 *   - audit  → runSkillAudit + formatAuditReport
 *   - list   → all loaded skills with status + source
 *   - usage  → per-skill usage stats from the JSONL ledger
 *   - review → skills flagged for review (stale or never-reviewed)
 *
 * Wired to /skills <subcommand> via slashCommands.ts.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  discoverSkills,
  runSkillAudit,
  formatAuditReport,
  getSkillUsageStats,
  skillsNeedingReview,
  skillStatus,
  assessSkillStaleness,
  type SkillStatus,
} from "../../../../skills/index.ts";

const subcommandSchema = z
  .enum(["audit", "list", "usage", "review"])
  .describe(
    "Subcommand: audit (full report) | list (all skills) | usage (invocation stats) | review (stale/never-reviewed skills)",
  );

export const skillsManagementTool = createTool({
  id: "skills_manage",
  description:
    "Inspect and govern Gordon's skill catalog. Subcommands: " +
    "'audit' (status + staleness + usage + verdict), " +
    "'list' (every loaded skill with source + status), " +
    "'usage' (per-skill invocation stats from the JSONL ledger), " +
    "'review' (skills flagged stale or never-reviewed). " +
    "Use when operator runs /skills <subcommand> or asks 'audit my skills', " +
    "'show skill usage', 'which skills haven't I reviewed'.",
  inputSchema: z.object({
    subcommand: subcommandSchema,
  }),
  outputSchema: z.object({
    subcommand: z.string(),
    /** Operator-readable rendered text. */
    text: z.string(),
    /** Structured payload — shape depends on subcommand. */
    data: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ subcommand }) => {
    try {
      const skills = discoverSkills();

      switch (subcommand) {
        case "audit": {
          const report = runSkillAudit(skills);
          return {
            subcommand,
            text: formatAuditReport(report),
            data: report,
          };
        }

        case "list": {
          if (skills.length === 0) {
            return { subcommand, text: "(no skills loaded)", data: { skills: [] } };
          }
          const rows = skills
            .map((s) => {
              const status: SkillStatus = skillStatus(s);
              const staleness = assessSkillStaleness(s);
              const age =
                staleness.daysSinceReview !== null ? `${staleness.daysSinceReview}d` : "never";
              return { id: s.id, status, source: s.source, lastReviewed: age };
            })
            .sort((a, b) => a.id.localeCompare(b.id));
          const lines = [
            `Loaded skills (${rows.length}):`,
            "",
            `  ${"ID".padEnd(30)}  ${"Status".padEnd(14)}  ${"Source".padEnd(10)}  Last Review`,
            `  ${"─".repeat(30)}  ${"─".repeat(14)}  ${"─".repeat(10)}  ${"─".repeat(11)}`,
            ...rows.map(
              (r) =>
                `  ${r.id.padEnd(30)}  ${r.status.padEnd(14)}  ${r.source.padEnd(10)}  ${r.lastReviewed}`,
            ),
          ];
          return { subcommand, text: lines.join("\n"), data: { skills: rows } };
        }

        case "usage": {
          const stats = getSkillUsageStats();
          if (stats.length === 0) {
            return {
              subcommand,
              text: "(no skill invocations recorded — usage ledger is empty)",
              data: { stats: [] },
            };
          }
          const lines = [
            `Skill usage (${stats.length} skills with recorded invocations, last 30d window):`,
            "",
            `  ${"ID".padEnd(30)}  ${"Recent".padEnd(8)}  ${"Total".padEnd(8)}  Last Invoked`,
            `  ${"─".repeat(30)}  ${"─".repeat(8)}  ${"─".repeat(8)}  ${"─".repeat(20)}`,
            ...stats.map((s) => {
              const last = s.lastInvoked ?? "—";
              return `  ${s.skillId.padEnd(30)}  ${String(s.recentInvocations).padEnd(8)}  ${String(s.totalInvocations).padEnd(8)}  ${last}`;
            }),
          ];
          return { subcommand, text: lines.join("\n"), data: { stats } };
        }

        case "review": {
          const review = skillsNeedingReview(skills);
          if (review.length === 0) {
            return {
              subcommand,
              text: "✓ All skills are fresh or recent — nothing needs review.",
              data: { needsReview: [] },
            };
          }
          const lines = [
            `Skills needing review (${review.length}):`,
            "",
            ...review.map((r) => {
              const age =
                r.daysSinceReview !== null
                  ? `${r.daysSinceReview} days since review`
                  : "never reviewed";
              return `  - ${r.skillId} (${age})`;
            }),
          ];
          return { subcommand, text: lines.join("\n"), data: { needsReview: review } };
        }
      }
    } catch (error) {
      return {
        subcommand,
        text: `Error running /skills ${subcommand}: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/**
 * Tool aggregation export — matches the historyTools pattern.
 */
export const skillsTools = {
  skills_manage: skillsManagementTool,
};
