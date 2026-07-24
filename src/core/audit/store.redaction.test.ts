import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setDatabasePathForTesting } from "../../infra/storage/database.ts";
import { saveTrace, getTrace, verifyStoredAuditChain } from "./store.ts";
import { provisionAuditSchema } from "./testSupport.ts";
import type { AuditTrace } from "./types.ts";

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-audit-redact-"));
  setDatabasePathForTesting(join(tempDir, "audit-redact-test.db"));
  // Shared-process runs can leave store.ts's one-shot table-init guard flipped
  // on a previous file's DB, so create the schema on this fresh handle directly.
  provisionAuditSchema();
});

afterAll(() => {
  setDatabasePathForTesting(null);
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Windows can hold SQLite WAL handles briefly; a leftover temp dir is fine.
  }
});

const SECRET = "sk-ant-api01-AAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function traceWithSecret(): AuditTrace {
  const now = new Date().toISOString();
  return {
    trace_id: randomUUID(),
    trigger: {
      type: "user_message",
      source: "test",
      payload_summary: `user pasted key ${SECRET} into chat`,
    },
    agent_steps: [
      {
        step_id: randomUUID(),
        agent_id: "executor",
        started_at: now,
        reasoning_summary: "place a trade",
        tool_calls: [
          {
            tool_name: "execute_plan",
            input_summary: `auth=${SECRET}`,
            output_summary: `broker response carried ${SECRET}`,
            duration_ms: 12,
            success: false,
            error: `rejected with token ${SECRET}`,
          },
        ],
      },
    ],
    outcome: {
      type: "trade_rejected",
      details: `failed because the request leaked ${SECRET}`,
    },
    started_at: now,
  };
}

describe("saveTrace — disk redaction", () => {
  it("redacts credential-shaped values out of every persisted summary field", () => {
    const saved = saveTrace(traceWithSecret());

    // The returned (persisted) trace must not carry the raw secret.
    expect(saved.trigger.payload_summary).not.toContain(SECRET);
    expect(saved.outcome.details).not.toContain(SECRET);
    const tc = saved.agent_steps[0]!.tool_calls[0]!;
    expect(tc.input_summary).not.toContain(SECRET);
    expect(tc.output_summary).not.toContain(SECRET);
    expect(tc.error).not.toContain(SECRET);
    expect(saved.outcome.details).toContain("[REDACTED]");
  });

  it("reload from disk returns the redacted content", () => {
    const saved = saveTrace(traceWithSecret());
    const back = getTrace(saved.trace_id);
    expect(back).not.toBeNull();
    expect(back!.outcome.details).not.toContain(SECRET);
    expect(back!.trigger.payload_summary).not.toContain(SECRET);
    expect(back!.agent_steps[0]!.tool_calls[0]!.output_summary).not.toContain(SECRET);
  });

  it("redacting before signing keeps the tamper chain intact", () => {
    saveTrace(traceWithSecret());
    const verification = verifyStoredAuditChain();
    expect(verification.valid).toBe(true);
  });
});
