import { executeWithLogging, getDatabase } from "../../storage/database.ts";
import { listActionLogEntries } from "../../action-log/store.ts";
import type { Message } from "../../ai/llm/types.ts";
import {
  curateMemoryBullets,
  formatMemoryBullets,
  reflectOnMessages,
  type CuratorResult,
} from "../../domain/memory/summarizer.ts";

interface ACEMemoryRow {
  threadId: string;
  bulletJson: string;
  renderedBlock: string;
  updatedAt: string;
}

export interface ACEMemorySnapshot {
  threadId: string;
  renderedBlock: string;
  updatedAt: string;
}

function toMessages(threadId: string, limit = 24): Message[] {
  const entries = listActionLogEntries({
    threadId,
    limit,
    entryTypes: ["user_message", "assistant_message"],
  });

  return [...entries]
    .reverse()
    .map((entry) => ({
      role: entry.entryType === "assistant_message" ? ("assistant" as const) : ("user" as const),
      content: entry.content || entry.title,
    }))
    .filter((message) => message.content.trim().length > 0);
}

export function rebuildACEMemoryForThread(threadId?: string): CuratorResult | null {
  if (!threadId) {
    return null;
  }

  const messages = toMessages(threadId);
  if (messages.length < 2) {
    return null;
  }

  const bullets = reflectOnMessages(messages);
  const curated = curateMemoryBullets(bullets);
  const renderedBlock = formatMemoryBullets(curated);
  const updatedAt = new Date().toISOString();
  const db = getDatabase();

  executeWithLogging(
    () =>
      db
        .query(
          `INSERT INTO ace_memory
          (threadId, bulletJson, renderedBlock, updatedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(threadId) DO UPDATE SET
           bulletJson = excluded.bulletJson,
           renderedBlock = excluded.renderedBlock,
           updatedAt = excluded.updatedAt`,
        )
        .run(threadId, JSON.stringify(curated.retained), renderedBlock, updatedAt),
    "UPSERT ace_memory",
  );

  return curated;
}

export function getACEMemorySnapshot(threadId?: string): ACEMemorySnapshot | null {
  if (!threadId) {
    return null;
  }

  const db = getDatabase();
  const row = executeWithLogging(
    () =>
      db.query("SELECT * FROM ace_memory WHERE threadId = ?").get(threadId) as ACEMemoryRow | null,
    "SELECT ace_memory one",
  );
  if (!row) {
    return null;
  }

  return {
    threadId: row.threadId,
    renderedBlock: row.renderedBlock,
    updatedAt: row.updatedAt,
  };
}

export function clearACEMemory(threadId: string): void {
  const db = getDatabase();
  executeWithLogging(
    () => db.query("DELETE FROM ace_memory WHERE threadId = ?").run(threadId),
    "DELETE ace_memory",
  );
}
