#!/usr/bin/env bun
/**
 * Periodic harness-simplification routine.
 *
 * Direct port of the cadence from learn-harness-engineering L12:
 *
 *   Every month, pick one harness component, temporarily disable it,
 *   and run benchmark tasks. If results don't degrade, remove it
 *   permanently. If they do, restore it or replace with a lighter
 *   alternative.
 *
 * What this script does:
 *   1. Reads the canonical list of Gordon's GORDON_* feature flags
 *      (the flag-gated harness primitives documented in CLAUDE.md).
 *   2. Loads the rotation state from ~/.gordon/harness-rotation.json
 *      — which flags have already been tested, what the outcomes were,
 *      and which one is up next.
 *   3. Emits a markdown report for the next-up flag:
 *        - the flag being tested
 *        - the recommended branch name + steps to disable it
 *        - the eval-harness command to run
 *        - the decision matrix (keep / remove / replace)
 *   4. Optionally records the outcome (--record-outcome) so future
 *      runs skip recently-tested flags.
 *
 * This script does NOT run the eval suite itself — the human operator
 * runs it on a feature branch with the flag disabled, then comes back
 * to record the outcome. The script is the *scheduler*, not the
 * benchmark itself.
 *
 * Usage:
 *   bun scripts/dev/harness/harness-simplification.ts            # show next flag to test
 *   bun scripts/dev/harness/harness-simplification.ts --status   # show full rotation state
 *   bun scripts/dev/harness/harness-simplification.ts --record-outcome <flag> <outcome>
 *     where <outcome> is one of: keep, remove, replace
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// The flag set is documented in CLAUDE.md under "Wiring feature flags".
// Each entry: env-var name + one-line description + a guess at the
// disabled-default-or-not. The script orders the rotation by
// last-tested ascending, so least-recently-checked flags surface first.
interface HarnessFlag {
  name: string;
  description: string;
  defaultEnabled: boolean;
}

const HARNESS_FLAGS: HarnessFlag[] = [
  {
    name: "GORDON_TOOL_OUTPUT_FILTERS",
    description: "Semantic compression of large tool outputs",
    defaultEnabled: false,
  },
  {
    name: "GORDON_TOOL_RESULT_CACHE",
    description: "Cache tool results with `unchanged` envelopes",
    defaultEnabled: false,
  },
  {
    name: "GORDON_EXTENDED_THINKING",
    description: "Anthropic native budget_tokens per workflow phase",
    defaultEnabled: false,
  },
  {
    name: "GORDON_AGENT_LIST_ATTACHMENT",
    description: "Agent list as system attachment",
    defaultEnabled: false,
  },
  {
    name: "GORDON_RECOVERY_TIERS",
    description: "Doom-loop escalation Notify→Redirect→ForceStop",
    defaultEnabled: false,
  },
  {
    name: "GORDON_TOOL_DEFERRAL",
    description: "Hide deferred tools from schema until activated",
    defaultEnabled: false,
  },
  {
    name: "GORDON_REMINDERS",
    description: "Turn-cadence reminders in autonomous loop",
    defaultEnabled: false,
  },
  {
    name: "GORDON_PERMISSION_BUBBLE",
    description: "Fork-tagged permission requests",
    defaultEnabled: false,
  },
  {
    name: "GORDON_ACE_ENABLED",
    description: "ACE Reflector→Curator lesson distillation",
    defaultEnabled: false,
  },
  {
    name: "GORDON_EXPLAIN_FIRST",
    description: "User writes thesis before seeing Gordon's",
    defaultEnabled: false,
  },
  {
    name: "GORDON_RISK_ACK",
    description: "Medium+ tier plans require risk acknowledgement",
    defaultEnabled: false,
  },
  {
    name: "GORDON_TRADING_UNIVERSE",
    description: "Universe-scope sentinel",
    defaultEnabled: false,
  },
  {
    name: "GORDON_THESIS_COHERENCE",
    description: "Portfolio coherence vs running thesis",
    defaultEnabled: false,
  },
  {
    name: "GORDON_STRATEGY_MANDATES",
    description: "Per-strategy mandate decomposition",
    defaultEnabled: false,
  },
  {
    name: "GORDON_TRADER_BEHAVIOR_PATTERNS",
    description: "Cross-session behavior pattern surfacing",
    defaultEnabled: false,
  },
  {
    name: "GORDON_SPRINT_CONTRACT",
    description: "Pre-session scope contract",
    defaultEnabled: false,
  },
  {
    name: "GORDON_PLAN_RUBRIC",
    description: "6-dimension plan-card rubric",
    defaultEnabled: false,
  },
  {
    name: "GORDON_CLEAN_STATE_GATE",
    description: "Session-end clean-state enforcement",
    defaultEnabled: false,
  },
];

type Outcome = "keep" | "remove" | "replace";

interface RotationEntry {
  flag: string;
  lastTestedAt: string;
  outcome: Outcome;
  notes?: string;
}

interface RotationState {
  entries: RotationEntry[];
}

const ROTATION_PATH =
  process.env.GORDON_HARNESS_ROTATION_PATH || join(homedir(), ".gordon", "harness-rotation.json");

function loadRotation(path: string = ROTATION_PATH): RotationState {
  if (!existsSync(path)) return { entries: [] };
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as RotationState;
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [] };
    return parsed;
  } catch {
    return { entries: [] };
  }
}

function saveRotation(state: RotationState, path: string = ROTATION_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

/**
 * Pick the next flag to test: least-recently-tested first, then
 * never-tested flags. A flag with outcome `remove` is skipped (it's
 * already been removed). A flag with outcome `replace` re-enters the
 * rotation after 90 days.
 */
function pickNextFlag(
  state: RotationState,
  flags: HarnessFlag[] = HARNESS_FLAGS,
): HarnessFlag | null {
  const byName = new Map<string, RotationEntry>();
  for (const e of state.entries) byName.set(e.flag, e);
  const now = Date.now();
  const candidates = flags.filter((f) => {
    const e = byName.get(f.name);
    if (!e) return true;
    if (e.outcome === "remove") return false;
    if (e.outcome === "replace") {
      const age = (now - new Date(e.lastTestedAt).getTime()) / (1000 * 60 * 60 * 24);
      return age >= 90;
    }
    // outcome === keep — re-test every 30 days
    const age = (now - new Date(e.lastTestedAt).getTime()) / (1000 * 60 * 60 * 24);
    return age >= 30;
  });
  if (candidates.length === 0) return null;
  // Order by last-tested ascending; never-tested first
  candidates.sort((a, b) => {
    const ae = byName.get(a.name);
    const be = byName.get(b.name);
    if (!ae && !be) return 0;
    if (!ae) return -1;
    if (!be) return 1;
    return ae.lastTestedAt.localeCompare(be.lastTestedAt);
  });
  return candidates[0] ?? null;
}

function renderReport(flag: HarnessFlag): string {
  return [
    `# Harness Simplification — ${flag.name}`,
    "",
    `**Flag:** \`${flag.name}\``,
    `**Description:** ${flag.description}`,
    `**Default enabled:** ${flag.defaultEnabled ? "yes" : "no"}`,
    "",
    "## Procedure",
    "",
    `1. Create a feature branch: \`git checkout -b harness-prune/${flag.name.toLowerCase()}\``,
    `2. Disable the flag for the duration of this test:`,
    `   - In \`bunfig.toml\`, ensure the flag is NOT set, OR`,
    `   - Export an explicit override: \`export ${flag.name}=0\``,
    `3. Run the eval suite:`,
    `   - \`bun test src/infra/domain/evals/harness/\``,
    `   - Capture the result for comparison`,
    `4. Run targeted safety/diagnostics regression:`,
    `   - \`bun test src/infra/safety/ src/infra/diagnostics/\``,
    `5. Spot-check the dependent code path manually if applicable`,
    "",
    "## Decision Matrix",
    "",
    "| Observed result | Action |",
    "|---|---|",
    "| Eval scores unchanged (within tolerance) and no test regression | `remove` permanently |",
    "| Eval scores dropped OR tests regressed | `keep` — flag is still load-bearing |",
    "| Eval scores unchanged but flag was solving a real pain point | `replace` with a lighter alternative |",
    "",
    "## Record the Outcome",
    "",
    "Once you've made the call:",
    "",
    "```sh",
    `bun scripts/dev/harness/harness-simplification.ts --record-outcome ${flag.name} <keep|remove|replace>`,
    "```",
    "",
    "If `remove`: open a PR deleting the flag-gated code path entirely.",
    "If `replace`: open a PR swapping in the lighter alternative and re-record next quarter.",
    "If `keep`: the rotation will skip this flag for 30 days, then resurface it.",
    "",
  ].join("\n");
}

function formatStatus(state: RotationState): string {
  const lines: string[] = [
    `Rotation state @ ${ROTATION_PATH}`,
    `Total flags: ${HARNESS_FLAGS.length}`,
    `Tested: ${state.entries.length}`,
    "",
  ];
  if (state.entries.length === 0) {
    lines.push("(no flags have been rotation-tested yet)");
  } else {
    const sorted = [...state.entries].sort((a, b) => a.lastTestedAt.localeCompare(b.lastTestedAt));
    for (const e of sorted) {
      lines.push(
        `  ${e.lastTestedAt.slice(0, 10)}  ${e.outcome.padEnd(8)}  ${e.flag}${e.notes ? `  — ${e.notes}` : ""}`,
      );
    }
  }
  const next = pickNextFlag(state);
  lines.push("");
  lines.push(`Next up: ${next ? next.name : "(nothing — all flags recently tested)"}`);
  return lines.join("\n");
}

function recordOutcome(
  state: RotationState,
  flag: string,
  outcome: Outcome,
  notes?: string,
): RotationState {
  const known = HARNESS_FLAGS.find((f) => f.name === flag);
  if (!known) {
    throw new Error(`Unknown flag: ${flag}. Known: ${HARNESS_FLAGS.map((f) => f.name).join(", ")}`);
  }
  const filtered = state.entries.filter((e) => e.flag !== flag);
  filtered.push({
    flag,
    lastTestedAt: new Date().toISOString(),
    outcome,
    notes,
  });
  return { entries: filtered };
}

// ============================================================================
// CLI
// ============================================================================

export {
  HARNESS_FLAGS,
  pickNextFlag,
  recordOutcome,
  renderReport,
  formatStatus,
  loadRotation,
  saveRotation,
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const state = loadRotation();

  if (args.includes("--status")) {
    console.log(formatStatus(state));
    process.exit(0);
  }

  const recordIdx = args.indexOf("--record-outcome");
  if (recordIdx !== -1) {
    const flag = args[recordIdx + 1];
    const outcome = args[recordIdx + 2] as Outcome;
    const notes = args[recordIdx + 3];
    if (!flag || !outcome || !["keep", "remove", "replace"].includes(outcome)) {
      console.error("Usage: --record-outcome <FLAG> <keep|remove|replace> [notes]");
      process.exit(2);
    }
    try {
      const next = recordOutcome(state, flag, outcome, notes);
      saveRotation(next);
      console.log(`Recorded: ${flag} -> ${outcome}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
    process.exit(0);
  }

  const next = pickNextFlag(state);
  if (!next) {
    console.log("All flags recently tested. Run with --status for details.");
    process.exit(0);
  }
  console.log(renderReport(next));
}
