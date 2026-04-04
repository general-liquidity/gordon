import { executeWithLogging, getDatabase } from "../storage/database.ts";
import type { TinyfishMonitorRecord, TinyfishMonitorRunRecord } from "./types.ts";

interface RawMonitorRow {
  monitorId: string;
  name: string | null;
  url: string;
  goal: string;
  cronExpr: string;
  browserProfile: string | null;
  proxyCountry: string | null;
  allowAuthenticated: number;
  enabled: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastStatus: "SUCCESS" | "FAILURE" | null;
  lastSummary: string | null;
}

interface RawRunRow {
  id: number;
  monitorId: string;
  status: "SUCCESS" | "FAILURE";
  summary: string | null;
  resultJson: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
}

let initialized = false;

function initTinyfishTables(): void {
  if (initialized) return;
  const db = getDatabase();
  db.run(`
    CREATE TABLE IF NOT EXISTS tinyfish_web_monitors (
      monitorId TEXT PRIMARY KEY,
      name TEXT,
      url TEXT NOT NULL,
      goal TEXT NOT NULL,
      cronExpr TEXT NOT NULL,
      browserProfile TEXT,
      proxyCountry TEXT,
      allowAuthenticated INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdBy TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      lastRunAt TEXT,
      lastStatus TEXT,
      lastSummary TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS tinyfish_web_monitor_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitorId TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      resultJson TEXT,
      error TEXT,
      startedAt TEXT NOT NULL,
      finishedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (monitorId) REFERENCES tinyfish_web_monitors(monitorId)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_tinyfish_monitors_enabled ON tinyfish_web_monitors(enabled)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tinyfish_monitor_runs_monitor ON tinyfish_web_monitor_runs(monitorId, id DESC)");
  initialized = true;
}

function rowToMonitor(row: RawMonitorRow): TinyfishMonitorRecord {
  return {
    monitorId: row.monitorId,
    name: row.name ?? undefined,
    url: row.url,
    goal: row.goal,
    cronExpr: row.cronExpr,
    browserProfile: row.browserProfile ?? undefined,
    proxyCountry: row.proxyCountry ?? undefined,
    allowAuthenticated: row.allowAuthenticated === 1,
    enabled: row.enabled === 1,
    createdBy: row.createdBy ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastRunAt: row.lastRunAt ?? undefined,
    lastStatus: row.lastStatus ?? undefined,
    lastSummary: row.lastSummary ?? undefined,
  };
}

function rowToMonitorRun(row: RawRunRow): TinyfishMonitorRunRecord {
  return {
    id: row.id,
    monitorId: row.monitorId,
    status: row.status,
    summary: row.summary ?? undefined,
    result: row.resultJson ? JSON.parse(row.resultJson) : undefined,
    error: row.error ?? undefined,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

export function upsertTinyfishMonitor(input: {
  monitorId: string;
  name?: string;
  url: string;
  goal: string;
  cronExpr: string;
  browserProfile?: string;
  proxyCountry?: string;
  allowAuthenticated?: boolean;
  enabled?: boolean;
  createdBy?: string;
}): TinyfishMonitorRecord {
  initTinyfishTables();
  const db = getDatabase();
  const now = new Date().toISOString();
  executeWithLogging(
    () =>
      db.query(
        `INSERT INTO tinyfish_web_monitors
          (monitorId, name, url, goal, cronExpr, browserProfile, proxyCountry, allowAuthenticated, enabled, createdBy, createdAt, updatedAt, lastRunAt, lastStatus, lastSummary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
         ON CONFLICT(monitorId) DO UPDATE SET
           name=excluded.name,
           url=excluded.url,
           goal=excluded.goal,
           cronExpr=excluded.cronExpr,
           browserProfile=excluded.browserProfile,
           proxyCountry=excluded.proxyCountry,
           allowAuthenticated=excluded.allowAuthenticated,
           enabled=excluded.enabled,
           createdBy=excluded.createdBy,
           updatedAt=excluded.updatedAt`
      ).run(
        input.monitorId,
        input.name ?? null,
        input.url,
        input.goal,
        input.cronExpr,
        input.browserProfile ?? null,
        input.proxyCountry ?? null,
        input.allowAuthenticated ? 1 : 0,
        input.enabled === false ? 0 : 1,
        input.createdBy ?? null,
        now,
        now,
      ),
    "UPSERT tinyfish_web_monitors",
  );

  return getTinyfishMonitor(input.monitorId)!;
}

export function getTinyfishMonitor(monitorId: string): TinyfishMonitorRecord | null {
  initTinyfishTables();
  const db = getDatabase();
  const row = executeWithLogging(
    () => db.query("SELECT * FROM tinyfish_web_monitors WHERE monitorId = ?").get(monitorId) as RawMonitorRow | null,
    "SELECT tinyfish_web_monitors one",
  );
  return row ? rowToMonitor(row) : null;
}

export function listTinyfishMonitors(): TinyfishMonitorRecord[] {
  initTinyfishTables();
  const db = getDatabase();
  const rows = executeWithLogging(
    () => db.query("SELECT * FROM tinyfish_web_monitors ORDER BY monitorId ASC").all() as RawMonitorRow[],
    "SELECT tinyfish_web_monitors all",
  );
  return rows.map(rowToMonitor);
}

export function deleteTinyfishMonitor(monitorId: string): boolean {
  initTinyfishTables();
  const db = getDatabase();
  const result = executeWithLogging(
    () => db.query("DELETE FROM tinyfish_web_monitors WHERE monitorId = ?").run(monitorId),
    "DELETE tinyfish_web_monitors",
  );
  return Number(result.changes ?? 0) > 0;
}

export function recordTinyfishMonitorRun(input: {
  monitorId: string;
  status: "SUCCESS" | "FAILURE";
  summary?: string;
  result?: unknown;
  error?: string;
  startedAt: string;
  finishedAt: string;
}): TinyfishMonitorRunRecord {
  initTinyfishTables();
  const db = getDatabase();
  const createdAt = new Date().toISOString();
  const insert = executeWithLogging(
    () =>
      db.query(
        `INSERT INTO tinyfish_web_monitor_runs
          (monitorId, status, summary, resultJson, error, startedAt, finishedAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.monitorId,
        input.status,
        input.summary ?? null,
        input.result !== undefined ? JSON.stringify(input.result) : null,
        input.error ?? null,
        input.startedAt,
        input.finishedAt,
        createdAt,
      ),
    "INSERT tinyfish_web_monitor_runs",
  );

  executeWithLogging(
    () =>
      db.query(
        `UPDATE tinyfish_web_monitors
         SET lastRunAt = ?, lastStatus = ?, lastSummary = ?, updatedAt = ?
         WHERE monitorId = ?`
      ).run(
        input.finishedAt,
        input.status,
        input.summary ?? input.error ?? null,
        createdAt,
        input.monitorId,
      ),
    "UPDATE tinyfish_web_monitors run-state",
  );

  const row = executeWithLogging(
    () => db.query("SELECT * FROM tinyfish_web_monitor_runs WHERE id = ?").get(Number(insert.lastInsertRowid ?? 0)) as RawRunRow,
    "SELECT tinyfish_web_monitor_runs one",
  );
  return rowToMonitorRun(row);
}

export function listTinyfishMonitorRuns(monitorId: string, limit: number = 20): TinyfishMonitorRunRecord[] {
  initTinyfishTables();
  const db = getDatabase();
  const rows = executeWithLogging(
    () =>
      db
        .query("SELECT * FROM tinyfish_web_monitor_runs WHERE monitorId = ? ORDER BY id DESC LIMIT ?")
        .all(monitorId, limit) as RawRunRow[],
    "SELECT tinyfish_web_monitor_runs recent",
  );
  return rows.map(rowToMonitorRun);
}
