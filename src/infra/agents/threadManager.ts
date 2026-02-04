/**
 * Thread Manager
 * Utilities for managing conversation threads including cloning for "what if" scenarios
 *
 * Thread cloning enables branching conversations to test different trade strategies
 * without affecting the original conversation context.
 */

import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { randomUUID } from "node:crypto";
import { createModuleLogger } from "../logger/index.ts";
import {
  loadSessionState,
  saveSessionState,
  generateThreadId,
  type SessionState,
} from "../storage/session.ts";

const logger = createModuleLogger("threadManager");

// ============================================================================
// Types
// ============================================================================

/**
 * Thread metadata including creation and cloning information
 */
export interface ThreadInfo {
  /** Unique thread identifier */
  threadId: string;
  /** User/resource ID that owns this thread */
  resourceId: string;
  /** When the thread was created */
  createdAt: string;
  /** If cloned, the source thread ID */
  clonedFrom: string | null;
  /** Human-readable label for the thread */
  label: string;
  /** Number of messages in the thread */
  messageCount: number;
  /** When the thread was last active */
  lastActiveAt: string;
  /** Whether this is the current active thread */
  isActive: boolean;
}

/**
 * Result of a clone operation
 */
export interface CloneResult {
  success: boolean;
  /** The new thread ID if successful */
  newThreadId: string | null;
  /** The source thread ID */
  sourceThreadId: string;
  /** Number of messages copied */
  messagesCopied: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Result of a thread switch operation
 */
export interface SwitchResult {
  success: boolean;
  /** The thread ID that was switched to */
  threadId: string;
  /** The previous thread ID */
  previousThreadId: string | null;
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// Thread Registry (In-memory + persisted metadata)
// ============================================================================

/**
 * Thread registry stored alongside session state
 */
interface ThreadRegistry {
  threads: Record<string, {
    threadId: string;
    resourceId: string;
    createdAt: string;
    clonedFrom: string | null;
    label: string;
    lastActiveAt: string;
  }>;
}

// In-memory cache of thread registry
let _threadRegistry: ThreadRegistry | null = null;

/**
 * Get the database URL for LibSQL
 */
function getDbUrl(): string {
  return process.env.DATABASE_URL || "file:gordon.db";
}

/**
 * Create a Memory instance for thread operations
 */
function createMemoryInstance(): Memory {
  const dbUrl = getDbUrl();
  return new Memory({
    storage: new LibSQLStore({
      id: "gordon-memory",
      url: dbUrl,
    }),
  });
}

/**
 * Load thread registry from session state
 */
async function loadThreadRegistry(): Promise<ThreadRegistry> {
  if (_threadRegistry) {
    return _threadRegistry;
  }

  const sessionState = await loadSessionState();

  // Extend session state to include thread registry if not present
  const extendedState = sessionState as SessionState & { threadRegistry?: ThreadRegistry };

  if (extendedState.threadRegistry) {
    _threadRegistry = extendedState.threadRegistry;
  } else {
    // Initialize empty registry
    _threadRegistry = { threads: {} };

    // If there's a current thread, add it to the registry
    if (sessionState.threadId) {
      _threadRegistry.threads[sessionState.threadId] = {
        threadId: sessionState.threadId,
        resourceId: sessionState.resourceId,
        createdAt: sessionState.threadStartedAt || new Date().toISOString(),
        clonedFrom: null,
        label: "Main Thread",
        lastActiveAt: sessionState.lastActiveAt,
      };
    }
  }

  return _threadRegistry;
}

/**
 * Save thread registry to session state
 */
async function saveThreadRegistry(registry: ThreadRegistry): Promise<void> {
  _threadRegistry = registry;

  const sessionState = await loadSessionState();
  const extendedState = sessionState as SessionState & { threadRegistry?: ThreadRegistry };
  extendedState.threadRegistry = registry;

  await saveSessionState(extendedState as SessionState);
}

/**
 * Register a new thread in the registry
 */
async function registerThread(info: {
  threadId: string;
  resourceId: string;
  clonedFrom?: string | null;
  label?: string;
}): Promise<void> {
  const registry = await loadThreadRegistry();
  const now = new Date().toISOString();

  registry.threads[info.threadId] = {
    threadId: info.threadId,
    resourceId: info.resourceId,
    createdAt: now,
    clonedFrom: info.clonedFrom || null,
    label: info.label || `Thread ${Object.keys(registry.threads).length + 1}`,
    lastActiveAt: now,
  };

  await saveThreadRegistry(registry);
  logger.info("Registered new thread", { threadId: info.threadId, label: info.label });
}

/**
 * Update thread's last active timestamp
 */
async function touchThread(threadId: string): Promise<void> {
  const registry = await loadThreadRegistry();

  if (registry.threads[threadId]) {
    registry.threads[threadId].lastActiveAt = new Date().toISOString();
    await saveThreadRegistry(registry);
  }
}

// ============================================================================
// Core Thread Operations
// ============================================================================

/**
 * Clone an existing thread to create a branch for "what if" scenarios
 *
 * This copies all messages from the source thread to a new thread,
 * preserving the conversation context and working memory.
 *
 * @param sourceThreadId - The thread ID to clone from
 * @param newThreadId - Optional custom ID for the new thread (auto-generated if not provided)
 * @param label - Optional human-readable label for the new thread
 * @returns CloneResult with the new thread ID
 */
export async function cloneThread(
  sourceThreadId: string,
  newThreadId?: string,
  label?: string
): Promise<CloneResult> {
  const startTime = Date.now();
  logger.info("Starting thread clone", { sourceThreadId, newThreadId });

  try {
    // Load session state to get resourceId
    const sessionState = await loadSessionState();
    const resourceId = sessionState.resourceId;

    // Generate new thread ID if not provided
    const targetThreadId = newThreadId || generateThreadId(resourceId);

    // Create memory instance
    const memory = createMemoryInstance();

    // Get messages from source thread
    // Mastra Memory's getContextWindow returns messages for a thread
    let messages: Array<{ role: string; content: string; id?: string; createdAt?: Date }> = [];
    let workingMemory: string | undefined;

    try {
      // Get thread context including messages and working memory
      // Using type assertion as getContextWindow may not be in public types
      const context = await (memory as unknown as {
        getContextWindow(params: { threadId: string; resourceId: string; format: string }): Promise<{
          messages?: Array<{ role: string; content: string; id?: string; createdAt?: Date }>;
          workingMemory?: string;
        }>;
      }).getContextWindow({
        threadId: sourceThreadId,
        resourceId,
        format: "raw",
      });

      // Extract messages from context
      if (context && Array.isArray(context.messages)) {
        messages = context.messages;
      }

      // Try to get working memory if available
      if (context && typeof context.workingMemory === "string") {
        workingMemory = context.workingMemory;
      }

      logger.debug("Retrieved source thread context", {
        sourceThreadId,
        messageCount: messages.length,
        hasWorkingMemory: !!workingMemory,
      });
    } catch (error) {
      // If we can't get messages, the source thread may not exist or be empty
      logger.warn("Could not retrieve source thread messages", {
        sourceThreadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Copy messages to new thread
    let messagesCopied = 0;
    for (const message of messages) {
      try {
        // Cast to bypass strict type checking - runtime structure matches expected format
        await (memory.saveMessages as (params: {
          messages: Array<{ role: string; content: unknown; id?: string; createdAt?: Date }>;
          threadId: string;
          resourceId: string;
        }) => Promise<unknown>)({
          messages: [{
            role: message.role,
            content: typeof message.content === "string"
              ? message.content
              : JSON.stringify(message.content),
            id: message.id || randomUUID(),
            createdAt: message.createdAt || new Date(),
          }],
          threadId: targetThreadId,
          resourceId,
        });
        messagesCopied++;
      } catch (error) {
        logger.warn("Failed to copy message", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Copy working memory if it exists
    if (workingMemory) {
      try {
        await memory.updateWorkingMemory({
          threadId: targetThreadId,
          resourceId,
          workingMemory,
        });
        logger.debug("Copied working memory to new thread");
      } catch (error) {
        logger.warn("Failed to copy working memory", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Register the new thread in our registry
    const cloneLabel = label || `Clone of ${sourceThreadId.slice(0, 15)}...`;
    await registerThread({
      threadId: targetThreadId,
      resourceId,
      clonedFrom: sourceThreadId,
      label: cloneLabel,
    });

    const duration = Date.now() - startTime;
    logger.info("Thread clone completed", {
      sourceThreadId,
      newThreadId: targetThreadId,
      messagesCopied,
      durationMs: duration,
    });

    return {
      success: true,
      newThreadId: targetThreadId,
      sourceThreadId,
      messagesCopied,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Thread clone failed", { sourceThreadId, error: errorMessage });

    return {
      success: false,
      newThreadId: null,
      sourceThreadId,
      messagesCopied: 0,
      error: errorMessage,
    };
  }
}

/**
 * List all threads for a user/resource
 *
 * @param resourceId - The resource/user ID to list threads for
 * @returns Array of ThreadInfo objects
 */
export async function listThreads(resourceId?: string): Promise<ThreadInfo[]> {
  try {
    // Get resourceId from session if not provided
    const sessionState = await loadSessionState();
    const effectiveResourceId = resourceId || sessionState.resourceId;
    const currentThreadId = sessionState.threadId;

    const registry = await loadThreadRegistry();

    // Filter threads by resourceId and convert to ThreadInfo
    const threadInfos: ThreadInfo[] = [];

    for (const [threadId, thread] of Object.entries(registry.threads)) {
      if (thread.resourceId === effectiveResourceId) {
        // Get message count from memory (best effort)
        let messageCount = 0;
        try {
          const memory = createMemoryInstance();
          // Using type assertion as getContextWindow may not be in public types
          const context = await (memory as unknown as {
            getContextWindow(params: { threadId: string; resourceId: string; format: string }): Promise<{
              messages?: Array<{ role: string; content: string }>;
            }>;
          }).getContextWindow({
            threadId,
            resourceId: effectiveResourceId,
            format: "raw",
          });
          if (context && Array.isArray(context.messages)) {
            messageCount = context.messages.length;
          }
        } catch {
          // Ignore errors getting message count
        }

        threadInfos.push({
          threadId: thread.threadId,
          resourceId: thread.resourceId,
          createdAt: thread.createdAt,
          clonedFrom: thread.clonedFrom,
          label: thread.label,
          messageCount,
          lastActiveAt: thread.lastActiveAt,
          isActive: thread.threadId === currentThreadId,
        });
      }
    }

    // Sort by last active time (most recent first)
    threadInfos.sort((a, b) =>
      new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    );

    logger.debug("Listed threads", {
      resourceId: effectiveResourceId,
      count: threadInfos.length,
    });

    return threadInfos;
  } catch (error) {
    logger.error("Failed to list threads", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Delete a thread and its messages
 *
 * @param threadId - The thread ID to delete
 * @returns Success status
 */
export async function deleteThread(threadId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const sessionState = await loadSessionState();

    // Prevent deleting the current active thread
    if (sessionState.threadId === threadId) {
      return {
        success: false,
        error: "Cannot delete the currently active thread. Switch to another thread first.",
      };
    }

    // Remove from registry
    const registry = await loadThreadRegistry();
    if (registry.threads[threadId]) {
      delete registry.threads[threadId];
      await saveThreadRegistry(registry);
    }

    // Note: We don't delete from LibSQL as Mastra Memory doesn't expose a delete API
    // The messages will be orphaned but won't affect anything
    // In a production system, you might want to add direct LibSQL cleanup

    logger.info("Thread deleted", { threadId });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to delete thread", { threadId, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

/**
 * Get detailed information about a thread
 *
 * @param threadId - The thread ID to get info for
 * @returns ThreadInfo or null if not found
 */
export async function getThreadInfo(threadId: string): Promise<ThreadInfo | null> {
  try {
    const sessionState = await loadSessionState();
    const registry = await loadThreadRegistry();

    const thread = registry.threads[threadId];
    if (!thread) {
      return null;
    }

    // Get message count from memory
    let messageCount = 0;
    try {
      const memory = createMemoryInstance();
      // Using type assertion as getContextWindow may not be in public types
      const context = await (memory as unknown as {
        getContextWindow(params: { threadId: string; resourceId: string; format: string }): Promise<{
          messages?: Array<{ role: string; content: string }>;
        }>;
      }).getContextWindow({
        threadId,
        resourceId: thread.resourceId,
        format: "raw",
      });
      if (context && Array.isArray(context.messages)) {
        messageCount = context.messages.length;
      }
    } catch {
      // Ignore errors getting message count
    }

    return {
      threadId: thread.threadId,
      resourceId: thread.resourceId,
      createdAt: thread.createdAt,
      clonedFrom: thread.clonedFrom,
      label: thread.label,
      messageCount,
      lastActiveAt: thread.lastActiveAt,
      isActive: thread.threadId === sessionState.threadId,
    };
  } catch (error) {
    logger.error("Failed to get thread info", {
      threadId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Switch to a different thread
 *
 * @param threadId - The thread ID to switch to
 * @returns SwitchResult with the new and previous thread IDs
 */
export async function switchThread(threadId: string): Promise<SwitchResult> {
  try {
    const sessionState = await loadSessionState();
    const previousThreadId = sessionState.threadId;

    // Verify the thread exists in our registry
    const registry = await loadThreadRegistry();
    if (!registry.threads[threadId]) {
      // Thread not in registry - might be a valid thread, add it
      await registerThread({
        threadId,
        resourceId: sessionState.resourceId,
        label: `Thread ${Object.keys(registry.threads).length + 1}`,
      });
    }

    // Update session state with new thread
    sessionState.threadId = threadId;
    sessionState.lastActiveAt = new Date().toISOString();
    await saveSessionState(sessionState);

    // Update thread's last active time
    await touchThread(threadId);

    logger.info("Switched thread", { from: previousThreadId, to: threadId });

    return {
      success: true,
      threadId,
      previousThreadId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to switch thread", { threadId, error: errorMessage });

    return {
      success: false,
      threadId,
      previousThreadId: null,
      error: errorMessage,
    };
  }
}

/**
 * Update a thread's label
 *
 * @param threadId - The thread ID to update
 * @param label - The new label
 * @returns Success status
 */
export async function updateThreadLabel(
  threadId: string,
  label: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const registry = await loadThreadRegistry();

    if (!registry.threads[threadId]) {
      return { success: false, error: "Thread not found" };
    }

    registry.threads[threadId].label = label;
    await saveThreadRegistry(registry);

    logger.info("Updated thread label", { threadId, label });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to update thread label", { threadId, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

/**
 * Ensure the current thread is registered
 * Should be called when initializing a session
 */
export async function ensureThreadRegistered(): Promise<void> {
  const sessionState = await loadSessionState();

  if (sessionState.threadId) {
    const registry = await loadThreadRegistry();

    if (!registry.threads[sessionState.threadId]) {
      await registerThread({
        threadId: sessionState.threadId,
        resourceId: sessionState.resourceId,
        label: "Main Thread",
      });
    }
  }
}
