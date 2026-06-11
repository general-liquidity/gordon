import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  setDatabasePathForTesting,
  getDatabase,
} from "../../infra/storage/database.ts";
import { saveTrace, verifyStoredAuditChain } from "./store.ts";
import type { AuditTrace } from "./types.ts";

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-audit-chain-"));
  setDatabasePathForTesting(join(tempDir, "audit-test.db"));
});

afterAll(() => {
  setDatabasePathForTesting(null);
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Windows can hold SQLite WAL handles briefly; a leftover temp dir is fine.
  }
});

function makeTrace(details: string): AuditTrace {
  const now = new Date().toISOString();
  return {
    trace_id: crypto.randomUUID(),
    trigger: { type: "system", source: "test", payload_summary: "payload" },
    agent_steps: [
      {
        step_id: crypto.randomUUID(),
        agent_id: "executor",
        started_at: now,
        ended_at: now,
        reasoning_summary: "reasoning",
        tool_calls: [
          {
            tool_name: "execute_plan",
            input_summary: "plan-1",
            output_summary: "filled",
            duration_ms: 12,
            success: true,
          },
        ],
      },
    ],
    outcome: { type: "trade_executed", position_id: "pos-1", details },
    started_at: now,
    ended_at: now,
    duration_ms: 20,
  };
}

describe("audit store signing round-trip", () => {
  it("signs on save, chains traces, and survives a DB round-trip", () => {
    const t1 = saveTrace(makeTrace("first"));
    const t2 = saveTrace(makeTrace("second"));
    const t3 = saveTrace(makeTrace("third"));

    expect(t1.signature).toBeTruthy();
    expect(t2.prev_signature).toBe(t1.signature!);
    expect(t3.prev_signature).toBe(t2.signature!);

    const result = verifyStoredAuditChain();
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(3);
  });

  it("detects in-database tampering with stored trace content", () => {
    const target = saveTrace(makeTrace("to be tampered"));

    getDatabase()
      .prepare("UPDATE audit_traces SET outcome_details = ? WHERE trace_id = ?")
      .run("rewritten by attacker", target.trace_id);

    const result = verifyStoredAuditChain();
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.firstBreak.reason).toBe("content_hash_mismatch");
    expect(result.firstBreak.traceId).toBe(target.trace_id);
  });

  it("detects deletion of a mid-chain trace", () => {
    // Remove the tampered trace from the previous test: its successor's
    // prev_signature link is now broken.
    const db = getDatabase();
    const tamperedId = (
      db
        .prepare("SELECT trace_id FROM audit_traces WHERE outcome_details = ?")
        .get("rewritten by attacker") as { trace_id: string }
    ).trace_id;
    const successor = saveTrace(makeTrace("after the deleted trace"));
    db.prepare("DELETE FROM audit_tool_calls WHERE step_id IN (SELECT step_id FROM audit_agent_steps WHERE trace_id = ?)").run(tamperedId);
    db.prepare("DELETE FROM audit_agent_steps WHERE trace_id = ?").run(tamperedId);
    db.prepare("DELETE FROM audit_traces WHERE trace_id = ?").run(tamperedId);

    const result = verifyStoredAuditChain();
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.firstBreak.reason).toBe("chain_link_mismatch");
    expect(result.firstBreak.traceId).toBe(successor.trace_id);
  });
});
