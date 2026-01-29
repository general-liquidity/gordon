/**
 * Memory Configuration for Mastra Agents
 *
 * Mastra requires memory for agent networks to track task history
 * and determine when tasks are complete.
 */

import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";

// ============================================================================
// Memory Store Configuration
// ============================================================================

/**
 * Create a memory store for Gordon agent networks
 *
 * Uses LibSQL (SQLite-compatible) for local persistence.
 * In production, this can be swapped for Turso (hosted LibSQL).
 */
export function createMemoryStore() {
  const dbUrl = process.env.GORDON_DATABASE_URL || process.env.DATABASE_URL || "file:gordon.db";

  return new Memory({
    storage: new LibSQLStore({ url: dbUrl }),
  });
}

// ============================================================================
// Memory Helpers
// ============================================================================

/**
 * Create memory options for a conversation
 */
export function createMemoryOptions(userId: string, threadId?: string) {
  return {
    threadId: threadId || `thread-${userId}-${Date.now()}`,
    resourceId: userId,
  };
}

/**
 * Generate a new thread ID for a conversation
 */
export function generateThreadId(userId: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `thread-${userId}-${timestamp}-${random}`;
}

// ============================================================================
// Singleton Memory Instance
// ============================================================================

let memoryInstance: Memory | null = null;

/**
 * Get the singleton memory instance
 * Creates it lazily on first access
 */
export function getMemory(): Memory {
  if (!memoryInstance) {
    memoryInstance = createMemoryStore();
  }
  return memoryInstance;
}

/**
 * Reset the memory instance (for testing)
 */
export function resetMemory(): void {
  memoryInstance = null;
}
