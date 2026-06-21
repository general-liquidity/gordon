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

function ensureDir(env: NodeJS.ProcessEnv = process.env): void {
  const dir = getAcpSessionsDir(env);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Non-fatal — caller handles append failure
    }
  }
}

/**
 * Append a turn to the session's transcript. Creates the file + dir
 * lazily; first append for a fresh session.
 */
export function appendSessionTurn(
  sessionId: string,
  turn: AcpSessionTurn,
  env: NodeJS.ProcessEnv = process.env,
): void {
  ensureDir(env);
  try {
    appendFileSync(sessionPath(sessionId, env), JSON.stringify(turn) + "\n", "utf-8");
  } catch {
    // Persistence is best-effort; transient FS errors shouldn't break the
    // prompt loop. The in-memory history (in GordonAcpAgent) is still
    // accurate for the current process.
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
export function sessionExists(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return existsSync(sessionPath(sessionId, env));
}
