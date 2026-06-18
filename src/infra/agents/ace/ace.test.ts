/**
 * Unit tests for the ACE Reflector → Curator pipeline.
 *
 * Tests the pure / file-IO surface behind GORDON_ACE_ENABLED. The Reflector
 * reads the action log via `listActionLogEntries`; we exercise the Curator
 * directly with synthetic Reflector output to avoid touching the real DB.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  formatACELessonsForPrompt,
  getACELessonsPath,
  isACEEnabled,
  loadACELessons,
  runCurator,
  runReflector,
} from "./index.ts";
import type { ReflectorOutput } from "./Reflector.ts";

let tempDir: string;
let tempLessonsPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ace-test-"));
  tempLessonsPath = join(tempDir, "ace-lessons.json");
  process.env.GORDON_ACE_LESSONS_PATH = tempLessonsPath;
  process.env.GORDON_ACE_ENABLED = "true";
});

afterEach(() => {
  delete process.env.GORDON_ACE_LESSONS_PATH;
  delete process.env.GORDON_ACE_ENABLED;
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function makeOutput(text: string, category: string, evidenceCount = 1): ReflectorOutput {
  return {
    candidates: [
      {
        text,
        category: category as never,
        evidenceCount,
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
        evidenceEntryIds: [],
      },
    ],
    entriesAnalyzed: 1,
    generatedAt: new Date().toISOString(),
  };
}

describe("ACE feature flag", () => {
  it("isACEEnabled reports true when env var is set", () => {
    expect(isACEEnabled()).toBe(true);
  });

  it("isACEEnabled reports false when env var is unset", () => {
    delete process.env.GORDON_ACE_ENABLED;
    expect(isACEEnabled()).toBe(false);
  });

  it("Reflector returns empty output when disabled", () => {
    delete process.env.GORDON_ACE_ENABLED;
    const out = runReflector({ lookbackEntries: 10 });
    expect(out.candidates).toEqual([]);
    expect(out.entriesAnalyzed).toBe(0);
  });

  it("Curator no-ops when disabled (does not write file)", () => {
    delete process.env.GORDON_ACE_ENABLED;
    runCurator(makeOutput("Should not be persisted", "risk_event"));
    expect(existsSync(tempLessonsPath)).toBe(false);
  });
});

describe("ACE Curator persistence", () => {
  it("getACELessonsPath honors GORDON_ACE_LESSONS_PATH", () => {
    expect(getACELessonsPath()).toBe(tempLessonsPath);
  });

  it("writes a new lesson and reloads it", () => {
    runCurator(makeOutput("Risk breach happened on Binance", "risk_event"));
    expect(existsSync(tempLessonsPath)).toBe(true);
    const store = loadACELessons();
    expect(store.lessons.length).toBe(1);
    expect(store.lessons[0]?.category).toBe("risk_event");
    expect(store.lessons[0]?.score).toBeGreaterThan(0);
  });

  it("merges duplicate candidates and increments evidenceCount", () => {
    // risk_event promotes on first occurrence, so the merge path is exercised
    // independent of the repeated-signal bar.
    runCurator(makeOutput("Risk breach recurred on Binance", "risk_event"));
    runCurator(makeOutput("Risk breach recurred on Binance", "risk_event"));
    const store = loadACELessons();
    expect(store.lessons.length).toBe(1);
    expect(store.lessons[0]?.evidenceCount).toBe(2);
  });

  it("ranks risk_event above operational lessons", () => {
    runCurator(makeOutput("Operator switched models", "operational"));
    runCurator(makeOutput("Drawdown event detected", "risk_event"));
    const store = loadACELessons();
    expect(store.lessons[0]?.category).toBe("risk_event");
  });

  it("formatACELessonsForPrompt returns block when lessons exist", () => {
    runCurator(makeOutput("User prefers swing trades", "user_preference"));
    const store = loadACELessons();
    const block = formatACELessonsForPrompt(store);
    expect(block).toContain("[GORDON_ACE_LESSONS]");
    expect(block).toContain("user_preference");
  });

  it("formatACELessonsForPrompt returns empty when disabled", () => {
    runCurator(makeOutput("Lesson", "operational"));
    const store = loadACELessons();
    delete process.env.GORDON_ACE_ENABLED;
    expect(formatACELessonsForPrompt(store)).toBe("");
  });
});

describe("ACE Curator — repeated-signal promotion bar", () => {
  it("HOLDS a single-occurrence inferred-category lesson (evidence 1)", () => {
    runCurator(makeOutput("Venue rate-limit observed once", "venue_quirk"));
    expect(loadACELessons().lessons.length).toBe(0);
  });

  it("promotes an inferred-category lesson once evidence reaches the bar (>=2)", () => {
    runCurator(makeOutput("Venue rate-limit observed", "venue_quirk", 2));
    const store = loadACELessons();
    expect(store.lessons.length).toBe(1);
    expect(store.lessons[0]?.category).toBe("venue_quirk");
  });

  it("promotes a safety/explicit category on the FIRST occurrence (evidence 1)", () => {
    runCurator(makeOutput("Drawdown breached on Binance", "risk_event"));
    expect(loadACELessons().lessons.length).toBe(1);
    // user_preference is an explicit operator statement — ground truth on first mention.
    runCurator(makeOutput("User prefers swing trades", "user_preference"));
    expect(loadACELessons().lessons.some((l) => l.category === "user_preference")).toBe(true);
  });

  it("a held one-off does not consume the edit budget", () => {
    // Two held one-offs then two promotable risk events: both risk events land.
    runCurator({
      candidates: [
        makeOutput("blip A", "venue_quirk").candidates[0]!,
        makeOutput("blip B", "operational").candidates[0]!,
        makeOutput("Drawdown one", "risk_event").candidates[0]!,
        makeOutput("Liquidation two", "risk_event").candidates[0]!,
      ],
      entriesAnalyzed: 4,
      generatedAt: new Date().toISOString(),
    });
    const store = loadACELessons();
    expect(store.lessons.every((l) => l.category === "risk_event")).toBe(true);
    expect(store.lessons.length).toBe(2);
  });
});

describe("ACE Curator — lesson-set content revision", () => {
  it("starts at 0 for an empty store and bumps to 1 on the first promotion", () => {
    expect(loadACELessons().revision).toBe(0);
    runCurator(makeOutput("Drawdown breached", "risk_event"));
    expect(loadACELessons().revision).toBe(1);
  });

  it("bumps again when evidence on an existing lesson is refreshed", () => {
    runCurator(makeOutput("Drawdown breached", "risk_event"));
    runCurator(makeOutput("Drawdown breached", "risk_event"));
    expect(loadACELessons().revision).toBe(2);
  });

  it("does NOT bump when a curation pass changes nothing (held one-off)", () => {
    runCurator(makeOutput("Drawdown breached", "risk_event"));
    const rev = loadACELessons().revision;
    runCurator(makeOutput("Some one-off venue blip", "venue_quirk"));
    expect(loadACELessons().revision).toBe(rev);
  });

  it("stamps the revision into the formatted prompt block for attribution", () => {
    runCurator(makeOutput("Drawdown breached", "risk_event"));
    const block = formatACELessonsForPrompt(loadACELessons());
    expect(block).toContain("revision 1");
  });

  it("is distinct from the schema version (which stays 1)", () => {
    runCurator(makeOutput("Drawdown breached", "risk_event"));
    runCurator(makeOutput("Liquidation hit", "risk_event"));
    const store = loadACELessons();
    expect(store.version).toBe(1);
    expect(store.revision).toBe(2);
  });
});

describe("ACE Reflector pattern detection", () => {
  it("returns empty candidates when action log is unavailable but ACE is enabled", () => {
    // Reflector should swallow store errors and return empty rather than throw.
    const out = runReflector({ lookbackEntries: 1 });
    expect(Array.isArray(out.candidates)).toBe(true);
    expect(out.entriesAnalyzed).toBeGreaterThanOrEqual(0);
  });
});

// Synthetic ActionLogEntry — minimum shape the Reflector reads.
type AnyEntry = {
  id: string;
  entryType: string;
  title: string;
  content: string;
  payload: Record<string, unknown>;
  bookmarked: boolean;
  createdAt: string;
};

function makeEntry(partial: Partial<AnyEntry>): AnyEntry {
  return {
    id: "test-id",
    entryType: "run_status",
    title: "",
    content: "",
    payload: {},
    bookmarked: false,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe("ACE Reflector — operator_override rule", () => {
  it("matches a user_message that countermands an agent decision", async () => {
    const { _applyPatternRulesForTest } = await import("./Reflector.ts");
    const entry = makeEntry({
      entryType: "user_message",
      content: "No, don't place that BTC long — too risky here, downsize it",
    });
    const matches = _applyPatternRulesForTest(entry as never);
    const override = matches.find((m) => m.category === "operator_override");
    expect(override).toBeDefined();
    expect(override?.text).toContain("OPERATOR OVERRIDE");
  });

  it("does NOT fire on a non-countermand user message", async () => {
    const { _applyPatternRulesForTest } = await import("./Reflector.ts");
    const entry = makeEntry({ entryType: "user_message", content: "What's the BTC trend today?" });
    const matches = _applyPatternRulesForTest(entry as never);
    expect(matches.find((m) => m.category === "operator_override")).toBeUndefined();
  });

  it("is weighted ABOVE execution_failure (operator override is the strongest learning signal)", () => {
    runCurator(makeOutput("An execution failed on Binance previously", "execution_failure"));
    runCurator(makeOutput("Operator overrode the agent: close it, too risky", "operator_override"));
    const store = loadACELessons();
    expect(store.lessons[0]?.category).toBe("operator_override");
  });
});

describe("ACE Reflector — agent_self_block rule", () => {
  it("matches a report_blocked-shaped run_status entry with intent + blocker", async () => {
    const { _applyPatternRulesForTest } = await import("./Reflector.ts");
    const entry = makeEntry({
      entryType: "run_status",
      title: "Agent reported blocked (severity: high)",
      content: 'Agent reported blocked while attempting: "place BTC long". Blocker: risk classifier blocks all variants because drawdown is at 4.8% of 5% cap.',
      payload: {
        intent: "place BTC long after user confirmed plan",
        blocker: "risk classifier blocks all variants because drawdown is at 4.8% of 5% cap",
        severity: "high",
      },
    });
    const matches = _applyPatternRulesForTest(entry as never);
    const selfBlock = matches.find((m) => m.category === "agent_self_block");
    expect(selfBlock).toBeDefined();
    expect(selfBlock?.text).toContain("place BTC long");
  });

  it("does not match run_status entries that aren't block reports", async () => {
    const { _applyPatternRulesForTest } = await import("./Reflector.ts");
    const entry = makeEntry({
      entryType: "run_status",
      title: "Scan completed",
      content: "Scanned 50 symbols, found 3 setups",
      payload: {},
    });
    const matches = _applyPatternRulesForTest(entry as never);
    expect(matches.find((m) => m.category === "agent_self_block")).toBeUndefined();
  });

  it("falls back to a generic message when payload lacks intent/blocker", async () => {
    const { _applyPatternRulesForTest } = await import("./Reflector.ts");
    const entry = makeEntry({
      entryType: "run_status",
      title: "Agent reported blocked (severity: medium)",
      content: "Agent reported blocked on some task.",
      payload: {},
    });
    const matches = _applyPatternRulesForTest(entry as never);
    const selfBlock = matches.find((m) => m.category === "agent_self_block");
    expect(selfBlock).toBeDefined();
    expect(selfBlock?.text).toContain("escalate via report_blocked");
  });
});

describe("ACE Reflector — approved_plan_rationale rule", () => {
  it("matches execution_result entries with a substantive rationale", async () => {
    const { _applyPatternRulesForTest } = await import("./Reflector.ts");
    const entry = makeEntry({
      entryType: "execution_result",
      title: "BTCUSDT executed",
      content: "Plan p1 executed cleanly on BTCUSDT. User rationale: Breakout above 100K confirmed with volume, plan stops sit below structural level.",
      payload: {
        planId: "p1",
        symbol: "BTCUSDT",
        rationale: "Breakout above 100K confirmed with volume, plan stops sit below structural level",
      },
    });
    const matches = _applyPatternRulesForTest(entry as never);
    const approved = matches.find((m) => m.category === "approved_plan_rationale");
    expect(approved).toBeDefined();
    expect(approved?.text).toContain("BTCUSDT");
    expect(approved?.text).toContain("Breakout above 100K");
  });

  it("does not match when rationale is missing or trivially short", async () => {
    const { _applyPatternRulesForTest } = await import("./Reflector.ts");
    const entry = makeEntry({
      entryType: "execution_result",
      title: "BTC executed",
      content: "Plan executed",
      payload: { rationale: "ok" }, // too short (<10 chars)
    });
    const matches = _applyPatternRulesForTest(entry as never);
    expect(matches.find((m) => m.category === "approved_plan_rationale")).toBeUndefined();
  });

  it("does not match execution_result entries that indicate failure", async () => {
    const { _applyPatternRulesForTest } = await import("./Reflector.ts");
    const entry = makeEntry({
      entryType: "execution_result",
      title: "BTC execution rejected",
      content: "Plan failed: risk gate blocked the trade. User rationale: test",
      payload: { rationale: "tried to push through the risk gate" },
    });
    const matches = _applyPatternRulesForTest(entry as never);
    expect(matches.find((m) => m.category === "approved_plan_rationale")).toBeUndefined();
  });

  it("ignores entries with the wrong entryType", async () => {
    const { _applyPatternRulesForTest } = await import("./Reflector.ts");
    const entry = makeEntry({
      entryType: "tool_result",
      title: "Something",
      content: "Some content",
      payload: { rationale: "a meaningful rationale here that's long enough" },
    });
    const matches = _applyPatternRulesForTest(entry as never);
    expect(matches.find((m) => m.category === "approved_plan_rationale")).toBeUndefined();
  });
});

describe("ACE Reflector — existing rules still match", () => {
  it("execution_success still fires on a clean fill", async () => {
    const { _applyPatternRulesForTest } = await import("./Reflector.ts");
    const entry = makeEntry({
      entryType: "execution_result",
      title: "ETHUSDT executed",
      content: "Order filled successfully",
      payload: { symbol: "ETHUSDT" },
    });
    const matches = _applyPatternRulesForTest(entry as never);
    expect(matches.find((m) => m.category === "execution_success")).toBeDefined();
  });

  it("execution_failure still fires on a rejected execution", async () => {
    const { _applyPatternRulesForTest } = await import("./Reflector.ts");
    const entry = makeEntry({
      entryType: "execution_result",
      title: "Execution rejected",
      content: "Order rejected: insufficient balance",
      payload: { venue: "binance" },
    });
    const matches = _applyPatternRulesForTest(entry as never);
    expect(matches.find((m) => m.category === "execution_failure")).toBeDefined();
  });
});

describe("ACE Reflector — execution_failure infra-noise guard", () => {
  it("does NOT emit a lesson when the failure is pure infra noise", async () => {
    const { _applyPatternRulesForTest } = await import("./Reflector.ts");
    const entry = makeEntry({
      entryType: "execution_result",
      title: "Order failed",
      content: "Order failed: ECONNREFUSED bridge unreachable",
      payload: { venue: "binance" },
    });
    const matches = _applyPatternRulesForTest(entry as never);
    expect(matches.find((m) => m.category === "execution_failure")).toBeUndefined();
  });

  it("STILL emits a lesson for a genuine trading failure", async () => {
    const { _applyPatternRulesForTest } = await import("./Reflector.ts");
    const entry = makeEntry({
      entryType: "execution_result",
      title: "Order rejected",
      content: "Order rejected: insufficient margin",
      payload: { venue: "binance" },
    });
    const matches = _applyPatternRulesForTest(entry as never);
    expect(matches.find((m) => m.category === "execution_failure")).toBeDefined();
  });

  it("isInfraNoise classifies transient infra/data errors as noise", async () => {
    const { isInfraNoise } = await import("./Reflector.ts");
    expect(isInfraNoise("connection reset / network unreachable")).toBe(true);
    expect(isInfraNoise("fetch failed: ETIMEDOUT")).toBe(true);
    expect(isInfraNoise("cannot read property 'price' of undefined")).toBe(true);
    expect(isInfraNoise("data stale, no bars returned")).toBe(true);
  });

  it("isInfraNoise does NOT flag genuine trading failures", async () => {
    const { isInfraNoise } = await import("./Reflector.ts");
    expect(isInfraNoise("rejected: insufficient balance")).toBe(false);
    expect(isInfraNoise("order denied by risk policy")).toBe(false);
  });
});
