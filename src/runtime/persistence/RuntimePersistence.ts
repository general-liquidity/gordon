import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { GORDON_DIR } from "../../infra/storage/paths.ts";
import type {
  RuntimeHistoryResult,
  RuntimeHistorySessionSummary,
} from "../contracts/types.ts";
import type { RuntimeSessionState } from "../state/SessionState.ts";
import type { RuntimeTranscriptEntry } from "../contracts/types.ts";
import type { HandoffArtifact, WorkerScratchpadEntry } from "../workers/HandoffArtifact.ts";

interface PersistedHistoryRow {
  runtime_id: string;
  source: "transcript" | "scratchpad" | "handoff" | "bridge" | "approval";
  entry_id: string;
  timestamp: string;
  role: RuntimeHistoryResult["role"] | null;
  worker: string | null;
  content: string;
  metadata_json: string | null;
}

export interface RuntimePersistenceSnapshot {
  runtimeState?: RuntimeSessionState;
  transcript?: RuntimeTranscriptEntry[];
  scratchpad?: {
    entries?: WorkerScratchpadEntry[];
    handoffs?: HandoffArtifact[];
  };
}

export interface RuntimePersistenceOptions {
  baseDir?: string;
  dbPath?: string;
}

function parseJson<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export class RuntimePersistence {
  private readonly baseDir: string;
  private readonly dbPath: string;
  private readonly db: Database;

  constructor(options: RuntimePersistenceOptions = {}) {
    const preferredDir = options.baseDir ?? join(GORDON_DIR, "runtime");
    this.baseDir = this.resolveWritableBaseDir(preferredDir);
    this.dbPath = options.dbPath ?? join(this.baseDir, "runtime-state.sqlite");
    this.db = new Database(this.dbPath);
    this.initSchema();
  }

  load(runtimeId: string): RuntimePersistenceSnapshot | null {
    const snapshotRow = this.db
      .query("SELECT session_state_json FROM runtime_snapshots WHERE runtime_id = ?1")
      .get(runtimeId) as { session_state_json: string | null } | null;

    const transcriptRows = this.db
      .query(
        `SELECT entry_id, timestamp, role, content, metadata_json
         FROM runtime_transcript_entries
         WHERE runtime_id = ?1
         ORDER BY entry_order ASC`,
      )
      .all(runtimeId) as Array<{
        entry_id: string;
        timestamp: string;
        role: RuntimeTranscriptEntry["role"];
        content: string;
        metadata_json: string | null;
      }>;

    const scratchpadRows = this.db
      .query(
        `SELECT entry_id, timestamp, worker, kind, content, metadata_json
         FROM runtime_scratchpad_entries
         WHERE runtime_id = ?1
         ORDER BY entry_order ASC`,
      )
      .all(runtimeId) as Array<{
        entry_id: string;
        timestamp: string;
        worker: WorkerScratchpadEntry["worker"];
        kind: WorkerScratchpadEntry["kind"];
        content: string;
        metadata_json: string | null;
      }>;

    const handoffRows = this.db
      .query(
        `SELECT handoff_id, timestamp, from_worker, to_worker, reason, payload_json
         FROM runtime_handoffs
         WHERE runtime_id = ?1
         ORDER BY entry_order ASC`,
      )
      .all(runtimeId) as Array<{
        handoff_id: string;
        timestamp: string;
        from_worker: HandoffArtifact["fromWorker"];
        to_worker: HandoffArtifact["toWorker"];
        reason: string;
        payload_json: string | null;
      }>;

    const runtimeState = parseJson<RuntimeSessionState>(snapshotRow?.session_state_json ?? null);
    const transcript = transcriptRows.map((row) => ({
      id: row.entry_id,
      timestamp: row.timestamp,
      role: row.role,
      content: row.content,
      metadata: parseJson<Record<string, unknown>>(row.metadata_json) ?? undefined,
    }));
    const scratchpadEntries = scratchpadRows.map((row) => ({
      id: row.entry_id,
      timestamp: row.timestamp,
      worker: row.worker,
      kind: row.kind,
      content: row.content,
      metadata: parseJson<Record<string, unknown>>(row.metadata_json) ?? undefined,
    }));
    const handoffs = handoffRows.map((row) => ({
      ...(parseJson<HandoffArtifact>(row.payload_json) ?? {
        id: row.handoff_id,
        timestamp: row.timestamp,
        fromWorker: row.from_worker,
        toWorker: row.to_worker,
        reason: row.reason,
      }),
    }));

    if (!runtimeState && transcript.length === 0 && scratchpadEntries.length === 0 && handoffs.length === 0) {
      return null;
    }

    return {
      runtimeState,
      transcript,
      scratchpad: {
        entries: scratchpadEntries,
        handoffs,
      },
    };
  }

  save(runtimeId: string, snapshot: RuntimePersistenceSnapshot): void {
    const savedAt = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .query(
          `INSERT INTO runtime_snapshots (runtime_id, saved_at, session_state_json)
           VALUES (?1, ?2, ?3)
           ON CONFLICT(runtime_id) DO UPDATE SET
             saved_at = excluded.saved_at,
             session_state_json = excluded.session_state_json`,
        )
        .run(runtimeId, savedAt, JSON.stringify(snapshot.runtimeState ?? null));

      this.db.query("DELETE FROM runtime_transcript_entries WHERE runtime_id = ?1").run(runtimeId);
      this.db.query("DELETE FROM runtime_scratchpad_entries WHERE runtime_id = ?1").run(runtimeId);
      this.db.query("DELETE FROM runtime_handoffs WHERE runtime_id = ?1").run(runtimeId);
      this.db.query("DELETE FROM runtime_history_index WHERE runtime_id = ?1").run(runtimeId);

      const transcriptInsert = this.db.query(
        `INSERT INTO runtime_transcript_entries
           (runtime_id, entry_order, entry_id, timestamp, role, content, metadata_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      );
      const scratchpadInsert = this.db.query(
        `INSERT INTO runtime_scratchpad_entries
           (runtime_id, entry_order, entry_id, timestamp, worker, kind, content, metadata_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      );
      const handoffInsert = this.db.query(
        `INSERT INTO runtime_handoffs
           (runtime_id, entry_order, handoff_id, timestamp, from_worker, to_worker, reason, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      );
      const historyInsert = this.db.query(
        `INSERT INTO runtime_history_index
           (runtime_id, source, entry_id, timestamp, role, worker, content, metadata_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      );

      for (const [index, entry] of (snapshot.transcript ?? []).entries()) {
        const metadataJson = entry.metadata ? JSON.stringify(entry.metadata) : null;
        transcriptInsert.run(runtimeId, index, entry.id, entry.timestamp, entry.role, entry.content, metadataJson);
        historyInsert.run(runtimeId, "transcript", entry.id, entry.timestamp, entry.role, null, entry.content, metadataJson);
      }

      for (const [index, entry] of (snapshot.scratchpad?.entries ?? []).entries()) {
        const metadataJson = entry.metadata ? JSON.stringify(entry.metadata) : null;
        scratchpadInsert.run(runtimeId, index, entry.id, entry.timestamp, entry.worker, entry.kind, entry.content, metadataJson);
        historyInsert.run(runtimeId, "scratchpad", entry.id, entry.timestamp, null, entry.worker, entry.content, metadataJson);
      }

      for (const [index, handoff] of (snapshot.scratchpad?.handoffs ?? []).entries()) {
        const payloadJson = JSON.stringify(handoff);
        handoffInsert.run(runtimeId, index, handoff.id, handoff.timestamp, handoff.fromWorker, handoff.toWorker, handoff.reason, payloadJson);
        historyInsert.run(
          runtimeId,
          "handoff",
          handoff.id,
          handoff.timestamp,
          null,
          `${handoff.fromWorker}->${handoff.toWorker}`,
          handoff.reason,
          payloadJson,
        );
      }

      for (const approval of snapshot.runtimeState?.approvals.recent ?? []) {
        const metadataJson = JSON.stringify({
          permissionScope: approval.permissionScope,
          approvalClass: approval.approvalClass,
          riskClass: approval.riskClass,
          sideEffectLevel: approval.sideEffectLevel,
          status: approval.status,
          actor: approval.actor,
          decisionSource: approval.decisionSource,
          fingerprint: approval.fingerprint,
          sessionId: approval.sessionId,
          resourceId: approval.resourceId,
          threadId: approval.threadId,
          requestedAt: approval.requestedAt,
          decidedAt: approval.decidedAt,
        });
        const approvalSummary = [
          approval.status,
          approval.toolName,
          approval.permissionScope,
          approval.reason,
          approval.actor,
        ].filter(Boolean).join(" · ");
        historyInsert.run(
          runtimeId,
          "approval",
          approval.id,
          approval.decidedAt ?? approval.requestedAt,
          null,
          approval.actor ?? null,
          approvalSummary,
          metadataJson,
        );
      }

      for (const bridgeSession of snapshot.runtimeState?.bridge.recent ?? []) {
        const metadataJson = JSON.stringify(bridgeSession);
        const bridgeSummary = [
          bridgeSession.source,
          bridgeSession.commandType,
          bridgeSession.status,
          bridgeSession.detail,
        ].filter(Boolean).join(" · ");
        historyInsert.run(
          runtimeId,
          "bridge",
          bridgeSession.id,
          bridgeSession.updatedAt,
          null,
          bridgeSession.source,
          bridgeSummary,
          metadataJson,
        );
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  searchHistory(
    query: string,
    options: { limit?: number; runtimeId?: string } = {},
  ): RuntimeHistoryResult[] {
    const trimmed = query.trim();
    const limit = Math.max(1, Math.min(options.limit ?? 12, 100));
    if (!trimmed) {
      return [];
    }

    const rows = options.runtimeId
      ? this.db
          .query(
            `SELECT runtime_id, source, entry_id, timestamp, role, worker, content, metadata_json
             FROM runtime_history_index
             WHERE runtime_id = ?1 AND content LIKE ?2
             ORDER BY timestamp DESC
             LIMIT ?3`,
          )
          .all(options.runtimeId, `%${trimmed}%`, limit)
      : this.db
          .query(
            `SELECT runtime_id, source, entry_id, timestamp, role, worker, content, metadata_json
             FROM runtime_history_index
             WHERE content LIKE ?1
             ORDER BY timestamp DESC
             LIMIT ?2`,
          )
          .all(`%${trimmed}%`, limit);

    return (rows as PersistedHistoryRow[]).map((row) => ({
      runtimeId: row.runtime_id,
      source: row.source,
      entryId: row.entry_id,
      role: row.role ?? undefined,
      worker: row.worker ?? undefined,
      timestamp: row.timestamp,
      content: row.content,
      metadata: parseJson<Record<string, unknown>>(row.metadata_json) ?? undefined,
    }));
  }

  listRecentSessions(limit: number = 12): RuntimeHistorySessionSummary[] {
    const rows = this.db
      .query(
        `SELECT runtime_id, saved_at, session_state_json
         FROM runtime_snapshots
         ORDER BY saved_at DESC
         LIMIT ?1`,
      )
      .all(Math.max(1, Math.min(limit, 100))) as Array<{
        runtime_id: string;
        saved_at: string;
        session_state_json: string | null;
      }>;

    const countQuery = this.db.query(
      "SELECT COUNT(*) as count FROM runtime_transcript_entries WHERE runtime_id = ?1",
    );

    return rows.map((row) => {
      const state = parseJson<RuntimeSessionState>(row.session_state_json);
      const countRow = countQuery.get(row.runtime_id) as { count: number } | null;
      return {
        runtimeId: row.runtime_id,
        sessionId: state?.session.sessionId,
        threadId: state?.session.threadId ?? state?.session.snapshot?.threadId ?? null,
        resourceId: state?.session.resourceId ?? state?.session.snapshot?.resourceId ?? null,
        savedAt: row.saved_at,
        transcriptEntryCount: countRow?.count ?? 0,
        lastUserMessage: state?.lastUserMessage,
        lastAssistantMessage: state?.lastAssistantMessage,
      };
    });
  }

  close(): void {
    this.db.close(false);
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_snapshots (
        runtime_id TEXT PRIMARY KEY,
        saved_at TEXT NOT NULL,
        session_state_json TEXT
      );

      CREATE TABLE IF NOT EXISTS runtime_transcript_entries (
        runtime_id TEXT NOT NULL,
        entry_order INTEGER NOT NULL,
        entry_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT,
        PRIMARY KEY (runtime_id, entry_id)
      );

      CREATE TABLE IF NOT EXISTS runtime_scratchpad_entries (
        runtime_id TEXT NOT NULL,
        entry_order INTEGER NOT NULL,
        entry_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        worker TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT,
        PRIMARY KEY (runtime_id, entry_id)
      );

      CREATE TABLE IF NOT EXISTS runtime_handoffs (
        runtime_id TEXT NOT NULL,
        entry_order INTEGER NOT NULL,
        handoff_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        from_worker TEXT NOT NULL,
        to_worker TEXT NOT NULL,
        reason TEXT NOT NULL,
        payload_json TEXT,
        PRIMARY KEY (runtime_id, handoff_id)
      );

      CREATE TABLE IF NOT EXISTS runtime_history_index (
        runtime_id TEXT NOT NULL,
        source TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        role TEXT,
        worker TEXT,
        content TEXT NOT NULL,
        metadata_json TEXT,
        PRIMARY KEY (runtime_id, source, entry_id)
      );

      CREATE INDEX IF NOT EXISTS idx_runtime_history_timestamp
        ON runtime_history_index(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_runtime_history_content
        ON runtime_history_index(content);
    `);
  }

  private resolveWritableBaseDir(preferredDir: string): string {
    try {
      mkdirSync(preferredDir, { recursive: true });
      return preferredDir;
    } catch {
      const fallbackDir = join(process.cwd(), ".gordon-runtime");
      if (!existsSync(fallbackDir)) {
        mkdirSync(fallbackDir, { recursive: true });
      }
      return fallbackDir;
    }
  }
}
