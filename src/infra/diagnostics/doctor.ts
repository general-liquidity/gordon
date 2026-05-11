/**
 * Doctor — diagnostic engine for Gordon's runtime state.
 *
 * Replaces the hardcoded 4-line placeholder in App.tsx with real checks
 * over the surfaces that have failure modes worth detecting. Every check
 * is read-only by default. Fixes route through existing user-trusted
 * commands (/cost reset, /exchange, etc.) — never silently mutates
 * state. The "do no harm" principle from CLI doctor-mode design: detect
 * exhaustively, repair conservatively.
 *
 * Each check returns a `DiagnosticCheck` matching the shape consumed
 * by `DoctorDialog.tsx`. The check function is pure with respect to
 * the filesystem and runtime state — it stats files, parses JSON, and
 * reads in-process state, but mutates nothing.
 *
 * Adding a new check:
 *   1. Add a const function returning `Promise<DiagnosticCheck>` or `DiagnosticCheck`
 *   2. Add it to the array in `runDoctorChecks()`
 *   3. Add a test in `doctor.test.ts`
 *
 * Future checks worth adding when failure modes surface:
 *   - Mastra `lastMessages` patch still applied in node_modules
 *   - MCP marketplace integrity check recency
 *   - critiquePhase.ts routing still uses "critique" not "compaction"
 *     (regression defense from commit b2f537fd)
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { isCostHalted, getCostTracker } from "../platform/costTracker.ts";
import { MAX_WORKING_MEMORY_CHARS } from "../agents/memoryGate.ts";
import { isSafetyCritical } from "../../runtime/permissions/trustTrajectory.ts";
import { getACELessonsPath } from "../agents/ace/index.ts";
import { defaultReviewQueuePath } from "../domain/evals/harness/reviewQueue.ts";
import { defaultAgentFeedbackPath } from "../agents/tools/agent-feedback.ts";

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "info";
  message: string;
  fixCommand?: string;
  fixLabel?: string;
}

// ============================================================================
// Path resolution
// ============================================================================

/**
 * Resolve `file:gordon.db` style Mastra storage URLs to a concrete path.
 * Defaults match `memoryFactory.ts:75-76`.
 */
function resolveMastraStoragePath(): string {
  const url = process.env.DATABASE_URL ?? "file:gordon.db";
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

function resolveVectorStoragePath(): string {
  const url = process.env.VECTOR_DATABASE_URL ?? "file:gordon-vector.db";
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

// ============================================================================
// Checks
// ============================================================================

function checkCostHaltState(): DiagnosticCheck {
  if (isCostHalted()) {
    return {
      id: "cost-halt",
      label: "Cost budget halt",
      status: "fail",
      message: "Session is halted because cost budget was exceeded. New API calls will be blocked.",
      fixCommand: "/cost reset",
      fixLabel: "Clear halt state and resume",
    };
  }
  return {
    id: "cost-halt",
    label: "Cost budget halt",
    status: "pass",
    message: "Session is within budget.",
  };
}

function checkCacheReadPressure(): DiagnosticCheck {
  const tracker = getCostTracker();
  const snap = tracker.snapshot();
  if (snap.totalApiCalls === 0) {
    return {
      id: "cache-read-pressure",
      label: "Cache-read pressure",
      status: "info",
      message: "No API calls recorded this session yet.",
    };
  }
  const pct = Math.round(snap.cacheReadPercentage * 100);
  if (snap.cacheReadPercentage >= 0.7) {
    return {
      id: "cache-read-pressure",
      label: "Cache-read pressure",
      status: "warn",
      message: `${pct}% of tokens are cache-read replay — likely context bloat. Consider /compact or restarting the session.`,
      fixCommand: "/compact",
      fixLabel: "Compact context",
    };
  }
  if (snap.cacheReadPercentage >= 0.5) {
    return {
      id: "cache-read-pressure",
      label: "Cache-read pressure",
      status: "info",
      message: `${pct}% cache-read (cache-heavy but below bloat threshold).`,
    };
  }
  return {
    id: "cache-read-pressure",
    label: "Cache-read pressure",
    status: "pass",
    message: `${pct}% of tokens are cache-read replay (healthy).`,
  };
}

function checkMastraStorage(): DiagnosticCheck {
  const path = resolveMastraStoragePath();
  if (!existsSync(path)) {
    return {
      id: "mastra-db",
      label: "Mastra storage",
      status: "info",
      message: `${path} not present yet — will be created on first session.`,
    };
  }
  try {
    const stats = statSync(path);
    if (stats.size === 0) {
      return {
        id: "mastra-db",
        label: "Mastra storage",
        status: "warn",
        message: `${path} exists but is empty — possible corruption.`,
      };
    }
    return {
      id: "mastra-db",
      label: "Mastra storage",
      status: "pass",
      message: `${path} (${Math.round(stats.size / 1024)} KB)`,
    };
  } catch (err) {
    return {
      id: "mastra-db",
      label: "Mastra storage",
      status: "fail",
      message: `Cannot stat ${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function checkVectorStorage(): DiagnosticCheck {
  const path = resolveVectorStoragePath();
  if (!existsSync(path)) {
    return {
      id: "vector-db",
      label: "Vector storage",
      status: "info",
      message: `${path} not present — vector tools will work once first embedding is recorded.`,
    };
  }
  try {
    const stats = statSync(path);
    return {
      id: "vector-db",
      label: "Vector storage",
      status: "pass",
      message: `${path} (${Math.round(stats.size / 1024)} KB)`,
    };
  } catch (err) {
    return {
      id: "vector-db",
      label: "Vector storage",
      status: "fail",
      message: `Cannot stat ${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function checkAceLessonsFile(): DiagnosticCheck {
  const path = getACELessonsPath();
  if (!existsSync(path)) {
    return {
      id: "ace-lessons",
      label: "ACE lessons store",
      status: "info",
      message: `${path} not present — run /reflect to populate.`,
    };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as { lessons?: unknown };
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.lessons)) {
      return {
        id: "ace-lessons",
        label: "ACE lessons store",
        status: "warn",
        message: `${path} parses but has unexpected shape (missing lessons array).`,
      };
    }
    return {
      id: "ace-lessons",
      label: "ACE lessons store",
      status: "pass",
      message: `${(parsed.lessons as unknown[]).length} lessons stored`,
    };
  } catch (err) {
    return {
      id: "ace-lessons",
      label: "ACE lessons store",
      status: "fail",
      message: `${path} unparseable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function checkJsonlIntegrity(
  id: string,
  label: string,
  path: string,
  noteWhenMissing: string,
): DiagnosticCheck {
  if (!existsSync(path)) {
    return {
      id,
      label,
      status: "info",
      message: noteWhenMissing,
    };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    let parseable = 0;
    let malformed = 0;
    for (const line of lines) {
      try {
        JSON.parse(line);
        parseable += 1;
      } catch {
        malformed += 1;
      }
    }
    if (malformed > 0) {
      return {
        id,
        label,
        status: "warn",
        message: `${parseable} parseable / ${malformed} malformed entries. Malformed lines are skipped on read; safe to ignore unless growing.`,
      };
    }
    return {
      id,
      label,
      status: "pass",
      message: `${parseable} entries, all parseable`,
    };
  } catch (err) {
    return {
      id,
      label,
      status: "fail",
      message: `Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function checkSafetyDenyList(): DiagnosticCheck {
  // Defensive regression check: the trust-trajectory deny-list patterns
  // must still recognize these canonical safety-critical tool names.
  // If isSafetyCritical() returns false for any of them, a refactor has
  // accidentally weakened the safety boundary.
  const expected = [
    "place_order",
    "execute_trade",
    "cancel_order",
    "wallet_transfer",
    "withdraw",
    "exec_shell",
  ];
  const missing = expected.filter((name) => !isSafetyCritical(name));
  if (missing.length > 0) {
    return {
      id: "safety-deny-list",
      label: "Safety-critical deny-list",
      status: "fail",
      message: `Expected patterns missing from deny-list: ${missing.join(", ")}. Trust-trajectory hook may auto-approve trades that should never be auto-approved.`,
    };
  }
  return {
    id: "safety-deny-list",
    label: "Safety-critical deny-list",
    status: "pass",
    message: `${expected.length} canonical patterns intact in trustTrajectory`,
  };
}

function checkHotTierCap(): DiagnosticCheck {
  // Regression defense for the Hermes hot-tier discipline (commit 900994d6).
  // If a future refactor changes MAX_WORKING_MEMORY_CHARS, surface it so
  // the user can re-derive whether the new value is intentional.
  const EXPECTED = 2200;
  if (MAX_WORKING_MEMORY_CHARS !== EXPECTED) {
    return {
      id: "hot-tier-cap",
      label: "Working-memory hot-tier cap",
      status: "warn",
      message: `MAX_WORKING_MEMORY_CHARS is ${MAX_WORKING_MEMORY_CHARS} (Hermes default is ${EXPECTED}). Confirm the change is intentional.`,
    };
  }
  return {
    id: "hot-tier-cap",
    label: "Working-memory hot-tier cap",
    status: "pass",
    message: `${MAX_WORKING_MEMORY_CHARS} chars (Hermes default)`,
  };
}

function checkGordonHomeDir(): DiagnosticCheck {
  const dir = join(homedir(), ".gordon");
  if (!existsSync(dir)) {
    return {
      id: "gordon-home",
      label: "~/.gordon directory",
      status: "info",
      message: `${dir} not present — will be created on first use.`,
    };
  }
  return {
    id: "gordon-home",
    label: "~/.gordon directory",
    status: "pass",
    message: dir,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run every diagnostic check and return the results in display order.
 * Pure with respect to filesystem and runtime state — read-only, no
 * mutation. Caller renders the results and routes fixes through
 * existing user-trusted commands.
 *
 * Synchronous on purpose: every current check is a stat / parse / state
 * read that completes in microseconds. If a future check needs to await
 * (e.g. LLM-provider ping for connectivity), refactor at that point.
 */
export function runDoctorChecks(): DiagnosticCheck[] {
  return [
    checkGordonHomeDir(),
    checkMastraStorage(),
    checkVectorStorage(),
    checkAceLessonsFile(),
    checkJsonlIntegrity(
      "eval-failures",
      "Eval-failures queue",
      defaultReviewQueuePath(),
      "No eval failures recorded yet.",
    ),
    checkJsonlIntegrity(
      "agent-feedback",
      "Agent-feedback queue",
      defaultAgentFeedbackPath(),
      "No agent feedback recorded yet.",
    ),
    checkCostHaltState(),
    checkCacheReadPressure(),
    checkSafetyDenyList(),
    checkHotTierCap(),
  ];
}

// Test helpers — keep checks individually exportable for targeted unit tests.
export const _internal = {
  checkCostHaltState,
  checkCacheReadPressure,
  checkMastraStorage,
  checkVectorStorage,
  checkAceLessonsFile,
  checkJsonlIntegrity,
  checkSafetyDenyList,
  checkHotTierCap,
  checkGordonHomeDir,
  resolveMastraStoragePath,
  resolveVectorStoragePath,
};
