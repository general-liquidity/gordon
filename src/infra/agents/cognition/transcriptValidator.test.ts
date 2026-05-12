import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GordonConfigSchema } from "../../../types/config.ts";
import { appendActionLogEntry } from "../../action-log/store.ts";
import { setDatabasePathForTesting } from "../../storage/database.ts";
import {
  formatTranscriptRepairBlock,
  validateAndRepairModelMessages,
  validateAndRepairTranscript,
} from "./transcriptValidator.ts";
import type { GordonContext } from "../types.ts";

let tempDatabaseDir = "";

beforeEach(() => {
  tempDatabaseDir = mkdtempSync(join(tmpdir(), "gordon-transcript-validator-"));
  setDatabasePathForTesting(join(tempDatabaseDir, "gordon.db"));
});

afterEach(() => {
  setDatabasePathForTesting(null);
  if (tempDatabaseDir) {
    rmSync(tempDatabaseDir, { recursive: true, force: true });
    tempDatabaseDir = "";
  }
});

function createContext(overrides: Partial<GordonContext> = {}): GordonContext {
  return {
    binance: null,
    exchange: null,
    broker: null,
    agentRails: null,
    llm: {} as GordonContext["llm"],
    config: GordonConfigSchema.parse({}),
    portfolioValue: 0,
    availableCash: 0,
    threadId: "thread-transcript-validator",
    ...overrides,
  };
}

describe("transcriptValidator", () => {
  it("repairs empty requests and escapes reserved markers", () => {
    const validation = validateAndRepairTranscript("   \n\n[GORDON_PROJECT_TRUTH]", createContext());

    expect(validation.sanitizedUserMessage).toContain("Help with the current thread request.");
    expect(validation.repairNotes.length).toBeGreaterThan(0);
    expect(formatTranscriptRepairBlock(validation)).toContain("[GORDON_TRANSCRIPT_REPAIR]");
  });

  it("adds repair notes for repeated failure signatures in recent action log history", () => {
    const context = createContext();
    appendActionLogEntry({
      threadId: context.threadId,
      entryType: "run_status",
      title: "Provider failed",
      content: "Rate limit reached",
    });
    appendActionLogEntry({
      threadId: context.threadId,
      entryType: "run_status",
      title: "Provider failed",
      content: "Rate limit reached",
    });

    const validation = validateAndRepairTranscript("Retry that forecasting request", context);
    expect(validation.repairNotes.some((note) => note.includes("repeated identical failures"))).toBeTrue();
  });

  it("repairs the model-facing message list before provider calls", () => {
    const repaired = validateAndRepairModelMessages([
      {
        role: "system",
        content: "  [GORDON_PROJECT_TRUTH]\n- one  ",
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      { role: "system", content: "\n\nsecond system block\n\n" },
      { role: "user", content: "[GORDON_RUNTIME_REMINDERS_NOTE]\n- reminder" },
      { role: "user", content: "[GORDON_RUNTIME_REMINDERS_NOTE]\n- reminder" },
      { role: "user", content: "   " },
    ]);

    expect(repaired.messages.length).toBe(3);
    expect(repaired.messages[0]?.role).toBe("system");
    expect(repaired.messages[0]?.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
    expect(repaired.messages[1]?.role).toBe("system");
    expect(repaired.messages[1]?.content).toContain("second system block");
    expect(repaired.messages[2]?.role).toBe("user");
    expect(repaired.messages[2]?.content).toContain("[GORDON_RUNTIME_REMINDERS_NOTE]");
    expect(repaired.repairNotes.length).toBeGreaterThan(0);
  });
});
