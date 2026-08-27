/**
 * Self-History Ingestion Adapter
 *
 * Feeds Gordon's OWN past chat-history session files (~/.gordon/history/*.json)
 * as records into the existing hybrid memory retrieval stack
 * (src/infra/memory/hybrid — BM25 + TF-IDF + MMR). This is NOT a parallel FTS
 * engine: it is a thin adapter that turns each past-session message into a
 * `MemoryEntry` the existing `hybridSearch` already knows how to rank, plus an
 * INCREMENTAL STALENESS CATALOG so months of sessions scale (only changed
 * session files are re-parsed).
 *
 * The gap this closes: Gordon's only prior search over its own past sessions
 * was `searchChatHistory` — a linear substring scan over the last 50 loaded
 * files with no ranking, no provenance, and no agent-facing recall tool.
 *
 * Coding-agent-specific ctx concepts (multi-provider importers, files_touched /
 * vcs_change models) are intentionally NOT ported — Gordon only indexes ITS OWN
 * chat sessions.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { GORDON_DIR } from "../../storage/paths.ts";
import type { ChatSession } from "../../storage/entities/chat-history.ts";

/** Current on-disk catalog schema version. Bump on incompatible changes. */
export const CATALOG_VERSION = 1;

/**
 * A single indexed record: one message from one past session. The `id` doubles
 * as the citation cursor (`<sessionId>#<messageIndex>`) so a recall hit can jump
 * back to the exact turn.
 */
export interface SessionRecord {
  /** Citation id — `${sessionId}#${messageIndex}`. */
  id: string;
  sessionId: string;
  messageIndex: number;
  role: string;
  /** Agent that produced an assistant message, when recorded. */
  agent?: string;
  content: string;
  /** Unix ms of the message (falls back to session start), or null if unknown. */
  timestamp: number | null;
}

/** Per-file staleness + record cache entry. */
export interface CatalogFileEntry {
  filename: string;
  sessionId: string;
  /** sha256 of the raw file bytes — source of truth for content change. */
  sha256: string;
  /** File mtime (ms) — cheap gate to skip re-hashing unchanged files. */
  mtimeMs: number;
  /** ISO timestamp this file was last (re)parsed into records. */
  indexedAt: string;
  messageCount: number;
  records: SessionRecord[];
}

/** The persisted staleness catalog — metadata + cached records per file. */
export interface HistoryIndexCatalog {
  version: number;
  files: Record<string, CatalogFileEntry>;
}

export interface RefreshOptions {
  /** Directory holding session JSON files. Defaults to `${GORDON_DIR}/history`. */
  historyDir?: string;
  /** Directory for the persisted catalog. Defaults to `${GORDON_DIR}/history-index`. */
  indexDir?: string;
}

/** Report of what an incremental refresh actually touched. */
export interface RefreshReport {
  /** Files (re)parsed into records this pass (new or content-changed). */
  indexed: string[];
  /** Files skipped — unchanged (mtime or sha match), records reused from cache. */
  reused: string[];
  /** Catalog entries dropped because their file no longer exists on disk. */
  removed: string[];
  /** Flattened records across every current file — feed straight to recall. */
  records: SessionRecord[];
}

const CATALOG_FILENAME = "catalog.json";

function defaultHistoryDir(): string {
  return join(GORDON_DIR, "history");
}

function defaultIndexDir(): string {
  return join(GORDON_DIR, "history-index");
}

export function computeSha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function catalogPath(indexDir: string): string {
  return join(indexDir, CATALOG_FILENAME);
}

/** Load the persisted catalog, or an empty one if absent/corrupt. */
export function loadCatalog(indexDir: string = defaultIndexDir()): HistoryIndexCatalog {
  const path = catalogPath(indexDir);
  if (!existsSync(path)) return { version: CATALOG_VERSION, files: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as HistoryIndexCatalog;
    if (
      parsed.version !== CATALOG_VERSION ||
      typeof parsed.files !== "object" ||
      parsed.files === null
    ) {
      return { version: CATALOG_VERSION, files: {} };
    }
    return parsed;
  } catch {
    return { version: CATALOG_VERSION, files: {} };
  }
}

/** Persist the catalog (creates the index dir on first write). */
export function saveCatalog(
  catalog: HistoryIndexCatalog,
  indexDir: string = defaultIndexDir(),
): void {
  if (!existsSync(indexDir)) mkdirSync(indexDir, { recursive: true });
  writeFileSync(catalogPath(indexDir), JSON.stringify(catalog), { encoding: "utf-8", mode: 0o600 });
}

function messageTimestampMs(iso: string | undefined, fallbackIso: string): number | null {
  const ms = new Date(iso ?? fallbackIso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Convert a loaded session into per-message records. Empty / whitespace-only
 * messages are skipped — they carry no recall signal and would only dilute IDF.
 */
export function sessionToRecords(session: ChatSession): SessionRecord[] {
  const records: SessionRecord[] = [];
  for (let i = 0; i < session.messages.length; i++) {
    const msg = session.messages[i]!;
    if (!msg.content || msg.content.trim().length === 0) continue;
    records.push({
      id: `${session.id}#${i}`,
      sessionId: session.id,
      messageIndex: i,
      role: msg.role,
      ...(msg.agent ? { agent: msg.agent } : {}),
      content: msg.content,
      timestamp: messageTimestampMs(msg.timestamp, session.startedAt),
    });
  }
  return records;
}

function listSessionFiles(historyDir: string): string[] {
  if (!existsSync(historyDir)) return [];
  try {
    return readdirSync(historyDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Incrementally refresh the index. Only NEW or CONTENT-CHANGED session files are
 * re-parsed; unchanged files reuse their cached records. Change detection is a
 * cheap mtime gate confirmed by sha256 (a `touch` that leaves content identical
 * counts as reused). Files deleted from disk are dropped from the catalog.
 *
 * The catalog is persisted after the pass so the next call starts warm.
 */
export function refreshIndex(options: RefreshOptions = {}): RefreshReport {
  const historyDir = options.historyDir ?? defaultHistoryDir();
  const indexDir = options.indexDir ?? defaultIndexDir();

  const catalog = loadCatalog(indexDir);
  const report: RefreshReport = { indexed: [], reused: [], removed: [], records: [] };

  const present = new Set<string>();
  for (const filename of listSessionFiles(historyDir)) {
    present.add(filename);
    const fullPath = join(historyDir, filename);

    let mtimeMs: number;
    try {
      mtimeMs = statSync(fullPath).mtimeMs;
    } catch {
      continue; // vanished between listing and stat — ignore
    }

    const existing = catalog.files[filename];
    // Cheap gate: mtime unchanged → content unchanged, reuse without reading.
    if (existing && existing.mtimeMs === mtimeMs) {
      report.reused.push(filename);
      continue;
    }

    let raw: string;
    try {
      raw = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }
    const sha256 = computeSha256(raw);

    // mtime moved but bytes identical (e.g. a touch or rewrite) → refresh the
    // mtime gate, keep cached records, count as reused (no re-parse).
    if (existing && existing.sha256 === sha256) {
      existing.mtimeMs = mtimeMs;
      report.reused.push(filename);
      continue;
    }

    let session: ChatSession;
    try {
      session = JSON.parse(raw) as ChatSession;
    } catch {
      // Corrupt file — drop any stale entry, skip.
      delete catalog.files[filename];
      continue;
    }

    const records = sessionToRecords(session);
    catalog.files[filename] = {
      filename,
      sessionId: session.id,
      sha256,
      mtimeMs,
      indexedAt: new Date().toISOString(),
      messageCount: records.length,
      records,
    };
    report.indexed.push(filename);
  }

  // Drop catalog entries whose file disappeared.
  for (const filename of Object.keys(catalog.files)) {
    if (!present.has(filename)) {
      delete catalog.files[filename];
      report.removed.push(filename);
    }
  }

  // Flatten every current file's records for the caller.
  for (const entry of Object.values(catalog.files)) {
    report.records.push(...entry.records);
  }

  saveCatalog(catalog, indexDir);
  return report;
}
