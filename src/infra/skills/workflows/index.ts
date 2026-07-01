/**
 * Builtin skill-workflow manifests (B3).
 *
 * Declarative pipelines that chain existing builtin skills into scheduled,
 * contract-checked flows. Each step's consumed fields are satisfied by an
 * upstream producer or a workflow input; `validateWorkflowManifests`
 * (workflowValidator.ts) proves that at author time. Every `skillId` below
 * references a builtin skill that resolves in the registry.
 *
 * These are programmatic (typed) rather than markdown — same convention as
 * slashCommands.ts. Add a workflow by appending a manifest here; the
 * workflows test re-validates the whole set against the live skill registry.
 */

import type { SkillWorkflowManifest } from "../types.ts";
import { field } from "../workflowValidator.ts";

/**
 * Daily top-of-session loop: brief the tape, scan for candidates, then
 * convert the read into a risk posture before any trade is proposed.
 */
const DAILY_OPERATING_LOOP: SkillWorkflowManifest = {
  id: "daily-operating-loop",
  name: "Daily Operating Loop",
  description:
    "Session-open discipline: brief the overnight tape, scan the watchlist against the regime, then set the day's risk posture. Run once at the start of each trading session.",
  cadence: "daily",
  version: "1",
  tags: ["routine", "session-open"],
  inputs: [field("watchlist", "array", { description: "Symbols the operator is tracking today" })],
  steps: [
    {
      skillId: "morning-brief",
      consumes: [field("watchlist", "array")],
      produces: [
        field("market_regime", "string", { description: "Current top-down regime read" }),
        field("overnight_events", "array", { description: "Material news / gaps since last close" }),
      ],
    },
    {
      skillId: "quick-scan",
      consumes: [field("watchlist", "array"), field("market_regime", "string")],
      produces: [field("scan_candidates", "array", { description: "Symbols passing the scan filters" })],
    },
    {
      skillId: "risk-check",
      consumes: [field("scan_candidates", "array"), field("market_regime", "string")],
      produces: [
        field("net_exposure_ceiling", "number", { description: "Deployable-capital ceiling for the session" }),
        field("risk_flags", "array"),
      ],
    },
  ],
};

/**
 * Weekly retrospective loop: review the book, then close the learning loop
 * with the behavioral coach and the setup model-book. This is where B11 +
 * B12 plug into the routine.
 */
const WEEKLY_REVIEW_LOOP: SkillWorkflowManifest = {
  id: "weekly-review-loop",
  name: "Weekly Review Loop",
  description:
    "End-of-week retrospective: review the book, extract behavioral coaching + next-session operating rules, then update the setup model-book with matured forward outcomes. Run once per week.",
  cadence: "weekly",
  version: "1",
  tags: ["routine", "review", "learning"],
  steps: [
    {
      skillId: "weekend-review",
      produces: [
        field("closed_trades", "array", { description: "Trades closed during the week" }),
        field("open_positions", "array", { description: "Positions still on the book" }),
      ],
    },
    {
      skillId: "exit-review",
      consumes: [field("open_positions", "array")],
      produces: [field("position_actions", "array", { description: "Hold/trim/close/tighten per position" })],
    },
    {
      skillId: "trade-performance-coach",
      consumes: [field("closed_trades", "array")],
      produces: [
        field("behavioral_tags", "array", { description: "Recurring behavioral pattern tags" }),
        field("next_session_operating_rules", "array", { description: "Prescriptive rules for the next session" }),
      ],
    },
    {
      skillId: "setup-model-book",
      consumes: [field("closed_trades", "array"), field("behavioral_tags", "array", { required: false })],
      produces: [
        field("cohort_stats", "object", { description: "Per-setup-tag forward-outcome statistics" }),
        field("rule_candidates", "array", { description: "Minted setup rule candidates" }),
      ],
    },
  ],
};

export const BUILTIN_WORKFLOWS: SkillWorkflowManifest[] = [
  DAILY_OPERATING_LOOP,
  WEEKLY_REVIEW_LOOP,
];

/** Look up a builtin workflow by ID. */
export function getWorkflow(id: string): SkillWorkflowManifest | undefined {
  return BUILTIN_WORKFLOWS.find((w) => w.id === id);
}
