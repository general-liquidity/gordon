/**
 * Test-only support for the audit store.
 *
 * NOT loaded by `bun test` as a suite (no `.test.ts` suffix) — it is a shared
 * helper imported by the audit-store tests.
 *
 * Why this exists: `store.ts#initAuditTables` is guarded by a module-level
 * `tablesInitialized` flag so it runs its DDL only once per process. When
 * several audit-store test files share one process (CI's `bun test`), the
 * first file flips that flag on ITS temp DB; a later file swaps in a fresh
 * temp DB via `setDatabasePathForTesting`, but the guard now short-circuits
 * `initAuditTables`, so `audit_traces` is never created on the new handle and
 * every query fails with `no such table: audit_traces`.
 *
 * `provisionAuditSchema` bypasses the stuck guard by issuing the audit DDL
 * directly against the current database handle. The statements mirror
 * `store.ts` exactly and are all `CREATE TABLE IF NOT EXISTS`, so calling this
 * on a fresh temp DB makes each test file hermetic regardless of run order.
 */

import { getDatabase } from "../../infra/storage/database.ts";

/** Create the audit tables on the current database handle if they are absent. */
export function provisionAuditSchema(): void {
  const db = getDatabase();

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_traces (
      trace_id TEXT PRIMARY KEY,
      parent_trace_id TEXT,
      trigger_type TEXT NOT NULL,
      trigger_event_type TEXT,
      trigger_source TEXT NOT NULL,
      trigger_payload_summary TEXT NOT NULL,
      outcome_type TEXT NOT NULL,
      outcome_position_id TEXT,
      outcome_details TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_ms REAL,
      risk_check_id TEXT,
      content_hash TEXT,
      prev_signature TEXT,
      signature TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_agent_steps (
      step_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      reasoning_summary TEXT NOT NULL DEFAULT '',
      handed_off_to TEXT,
      handoff_reason TEXT,
      durability_class TEXT,
      step_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (trace_id) REFERENCES audit_traces(trace_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      step_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      input_summary TEXT NOT NULL DEFAULT '',
      output_summary TEXT NOT NULL DEFAULT '',
      duration_ms REAL NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      durability_class TEXT,
      call_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (step_id) REFERENCES audit_agent_steps(step_id)
    )
  `);
}
