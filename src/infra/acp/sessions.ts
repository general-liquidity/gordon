/**
 * Session persistence for ACP mode.
 *
 * Sessions live at `~/.gordon/acp-sessions/<sessionId>.jsonl` — one JSON
 * object per line, append-only, consistent with Gordon's existing JSONL
 * patterns (action-log, trade-ledger, evidence-bundle).
 *
 * Each line: `{ "role": "user" | "assistant", "content": "...", "ts": <ms> }`
 *
 * Why JSONL: append-only writes survive partial process crashes (no
 * truncated JSON), and the file is line-greppable for debugging
 * (`tail -f ~/.gordon/acp-sessions/<id>.jsonl`).
 *
 * Override path via `GORDON_ACP_SESSIONS_PATH` for tests.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const ACP_SESSIONS_PATH_ENV = "GORDON_ACP_SESSIONS_PATH";

export interface AcpSessionTurn {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

interface AcpSessionModeRecord {
  kind: "mode";
  modeId: string;
  ts: number;
}

export function getAcpSessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env[ACP_SESSIONS_PATH_ENV] ?? join(homedir(), ".gordon", "acp-sessions");
}

/** Session ids that map 1:1 to a filename component — no path separators,
 *  no `..`, no drive/UNC tricks. Mirrors the validation in the ACP server. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Reject any session id that isn't a single safe path component. A peer
 * supplies the id over the wire, so an unsanitized value like
 * `"../../../../etc/passwd"` would otherwise escape the sessions dir on
 * both read (loadSessionTurns) and append-write (appendSessionTurn).
 */
export function sanitizeSessionId(sessionId: string): string {
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`Invalid ACP sessionId: ${JSON.stringify(sessionId)}`);
  }
  return sessionId;
}

function sessionPath(sessionId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(getAcpSessionsDir(env), `${sanitizeSessionId(sessionId)}.jsonl`);
}

function ensureDir(env: NodeJS.ProcessEnv = process.env): boolean {
  const dir = getAcpSessionsDir(env);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Append a turn to the session's transcript. Creates the file + dir
 * lazily; first append for a fresh session.
 */
export function appendSessionTurn(
  sessionId: string,
  turn: AcpSessionTurn,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!ensureDir(env)) return false;
  try {
    appendFileSync(sessionPath(sessionId, env), `${JSON.stringify(turn)}\n`, "utf-8");
    return true;
  } catch {
    // The boolean lets the ACP boundary fail the operation without mutating its
    // in-memory history or claiming the turn is resumable.
    return false;
  }
}

/** Append one completed user/assistant turn with a single filesystem write. */
export function appendSessionTurns(
  sessionId: string,
  turns: readonly AcpSessionTurn[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (turns.length === 0) return true;
  if (!ensureDir(env)) return false;
  try {
    const payload = `${turns.map((turn) => JSON.stringify(turn)).join("\n")}\n`;
    appendFileSync(sessionPath(sessionId, env), payload, "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function appendSessionMode(
  sessionId: string,
  modeId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!ensureDir(env)) return false;
  const record: AcpSessionModeRecord = { kind: "mode", modeId, ts: Date.now() };
  try {
    appendFileSync(sessionPath(sessionId, env), `${JSON.stringify(record)}\n`, "utf-8");
    return true;
  } catch {
    // The caller keeps the prior in-memory mode when persistence fails.
    return false;
  }
}

export function loadSessionMode(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const path = sessionPath(sessionId, env);
  if (!existsSync(path)) return null;
  try {
    let latest: string | null = null;
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Partial<AcpSessionModeRecord>;
        if (parsed.kind === "mode" && typeof parsed.modeId === "string") latest = parsed.modeId;
      } catch {
        // Line-isolated JSONL: a damaged turn cannot erase the last valid mode.
      }
    }
    return latest;
  } catch {
    return null;
  }
}

/**
 * Load a session's turn history from disk. Returns empty array when the
 * file doesn't exist (caller treats as "fresh session") or is unreadable.
 */
export function loadSessionTurns(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): AcpSessionTurn[] {
  const path = sessionPath(sessionId, env);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    const turns: AcpSessionTurn[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as AcpSessionTurn;
        if (
          (parsed.role === "user" || parsed.role === "assistant") &&
          typeof parsed.content === "string"
        ) {
          turns.push(parsed);
        }
      } catch {
        // Skip malformed lines without bailing — JSONL is line-isolated.
      }
    }
    return turns;
  } catch {
    return [];
  }
}

/**
 * Check whether a session id has any persisted turns. Used by
 * loadSession to decide between resume vs reject.
 */
export function sessionExists(sessionId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return existsSync(sessionPath(sessionId, env));
}
