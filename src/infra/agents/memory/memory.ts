/**
 * Memory Configuration for Mastra Agents
 *
 * Mastra requires memory for agent networks to track task history
 * and determine when tasks are complete.
 */

import { Memory } from "@mastra/memory";
import { createMastraStorageConfig } from "./mastraStorage.ts";

// ============================================================================
// Memory Store Configuration
// ============================================================================

/**
 * Create a memory store for Gordon agent networks
 *
 * Uses LibSQL (SQLite-compatible) for local persistence when available.
 * Standalone binaries fall back to in-memory storage if the native LibSQL runtime is unavailable.
 */
export function createMemoryStore() {
  const dbUrl = process.env.GORDON_DATABASE_URL || process.env.DATABASE_URL || "file:gordon.db";
  const { storage } = createMastraStorageConfig({
    storeId: "gordon-memory",
    dbUrl,
    enableVector: false,
  });

  return new Memory({
    storage,
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
