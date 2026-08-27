/**
 * Message Tombstones for Audit Trail
 *
 * Claude Code pattern: when messages are compacted or deleted, preserve a
 * tombstone with metadata (when removed, why, original size). Nothing is
 * truly lost — critical for trading audit compliance.
 *
 * Tombstones are stored in ~/.gordon/tombstones/ as NDJSON files (one per
 * session). They're append-only and never modified. External audit tools
 * can reconstruct the full conversation timeline.
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { GORDON_DIR } from "../../storage/paths.ts";

// ============================================================================
// Types
// ============================================================================

export type TombstoneReason =
  | "microcompact" // Content cleared by microcompact
  | "full_compact" // Replaced during full LLM summarization
  | "budget_trim" // Trimmed by conversation budget enforcement
  | "user_delete" // User explicitly deleted
  | "session_end" // Session cleanup
  | "error_recovery"; // Discarded during error recovery

export interface Tombstone {
  /** Unique identifier for this tombstone. */
  id: string;
  /** ISO timestamp when the message was removed. */
  removedAt: string;
  /** Why the message was removed. */
  reason: TombstoneReason;
  /** Role of the original message (user, assistant, tool). */
  role: string;
  /** Tool name if this was a tool result. */
  toolName?: string;
  /** Tool call ID for correlation. */
  toolCallId?: string;
  /** Original content size in characters. */
  originalSize: number;
  /** SHA-256 hash of the original content (for verification). */
  contentHash: string;
  /** First N characters of original content as preview. */
  preview: string;
  /** Turn number in the conversation. */
  turn?: number;
  /** Session ID. */
  sessionId?: string;
  /** Agent name if from a sub-agent. */
  agentName?: string;
}

// ============================================================================
// Hashing
// ============================================================================

async function sha256(content: string): Promise<string> {
  // Use Web Crypto API (available in Bun/Node 20+)
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================================================
// Storage
// ============================================================================

const TOMBSTONES_DIR = join(GORDON_DIR, "tombstones");
const PREVIEW_LENGTH = 500;

function ensureDir(): void {
  if (!existsSync(TOMBSTONES_DIR)) mkdirSync(TOMBSTONES_DIR, { recursive: true });
}

function getSessionFile(sessionId: string): string {
  const sanitized = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(TOMBSTONES_DIR, `${sanitized}.ndjson`);
}

// ============================================================================
// API
// ============================================================================

/**
 * Record a tombstone for a removed message. Append-only, never fails
 * (swallows errors to avoid disrupting the agent loop).
 */
export async function recordTombstone(params: {
  reason: TombstoneReason;
  role: string;
  content: string;
  toolName?: string;
  toolCallId?: string;
  turn?: number;
  sessionId?: string;
  agentName?: string;
}): Promise<Tombstone | null> {
  try {
    ensureDir();

    const tombstone: Tombstone = {
      id: `ts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      removedAt: new Date().toISOString(),
      reason: params.reason,
      role: params.role,
      toolName: params.toolName,
      toolCallId: params.toolCallId,
      originalSize: params.content.length,
      contentHash: await sha256(params.content),
      preview: params.content.slice(0, PREVIEW_LENGTH),
      turn: params.turn,
      sessionId: params.sessionId,
      agentName: params.agentName,
    };

    const file = getSessionFile(params.sessionId ?? "default");
    appendFileSync(file, `${JSON.stringify(tombstone)}\n`, { encoding: "utf-8", mode: 0o600 });

    return tombstone;
  } catch {
    // Tombstone recording must never crash the agent
    return null;
  }
}

/**
 * Batch-record tombstones for multiple messages (e.g., during compaction).
 */
export async function recordTombstones(
  messages: Array<{
    role: string;
    content: string;
    toolName?: string;
    toolCallId?: string;
    turn?: number;
  }>,
  reason: TombstoneReason,
  sessionId?: string,
): Promise<number> {
  let count = 0;
  for (const msg of messages) {
    const result = await recordTombstone({ ...msg, reason, sessionId });
    if (result) count++;
  }
  return count;
}

/**
 * Count tombstones for a session (for stats display).
 */
export function countTombstones(sessionId: string): number {
  const file = getSessionFile(sessionId);
  if (!existsSync(file)) return 0;
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const content = readFileSync(file, "utf-8");
    return content.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}
