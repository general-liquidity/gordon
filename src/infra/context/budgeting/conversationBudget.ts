/**
 * Conversation-Wide Tool Result Budget
 *
 * Unlike per-result spill (toolResultStorage.ts) which caps individual results,
 * this module enforces a CUMULATIVE budget across ALL tool results in the
 * conversation. When the budget is exceeded, the oldest results get truncated
 * or spilled — keeping the most recent results intact.
 *
 * Claude Code pattern: total tool result budget is tracked across the entire
 * conversation, not just per-turn. Old results are progressively trimmed as
 * new ones arrive.
 */

import { persistLargeResult, buildPersistedContent, PREVIEW_CHARS } from "../toolResultStorage.ts";
import { getToolResultBudget } from "../../agents/tools/runtime/rate/concurrency-classification.ts";

// ============================================================================
// Configuration
// ============================================================================

/** Max total chars of tool results retained in context. Default 500K chars (~140K tokens). */
export const DEFAULT_CONVERSATION_BUDGET_CHARS = 500_000;

/** When trimming, keep at least this many recent results untouched. */
export const MIN_KEEP_RECENT = 8;

/** After trimming an old result, replace with this. */
// This branch drops the content without spilling it, so there is nothing to
// read back — re-invoking the tool is the only recovery.
export const TRIMMED_MARKER = "[Tool result trimmed to save context — re-invoke the tool if you need it again]";

// ============================================================================
// Types
// ============================================================================

export interface TrackedResult {
  id: string;
  toolName: string;
  toolCallId: string;
  /** Current content (may have been trimmed). */
  content: string;
  /** Original size before any trimming. */
  originalSize: number;
  /** Turn number when this result was added. */
  turn: number;
  /** Whether this result has been spilled to disk. */
  spilledToDisk: boolean;
  /** Whether this result has been trimmed in-place. */
  trimmed: boolean;
}

export interface BudgetStats {
  totalChars: number;
  budgetChars: number;
  usageFraction: number;
  trackedResults: number;
  trimmedResults: number;
  spilledResults: number;
}

// ============================================================================
// Conversation Budget Tracker
// ============================================================================

export class ConversationBudget {
  private results: TrackedResult[] = [];
  private budgetChars: number;
  private nextId: number = 0;

  constructor(budgetChars: number = DEFAULT_CONVERSATION_BUDGET_CHARS) {
    this.budgetChars = budgetChars;
  }

  /**
   * Track a new tool result. Enforces per-family result budget (from
   * concurrency classification) BEFORE adding to conversation budget,
   * then enforces the global conversation budget on top.
   *
   * Per-family budgets (Claude Code pattern): market data gets 80K,
   * backtests get 100K, analysis 60K, trade execution 20K, etc.
   */
  add(toolName: string, toolCallId: string, content: string, turn: number): TrackedResult {
    // Per-family result budget: trim individual result before tracking
    const familyBudget = getToolResultBudget(toolName);
    let trimmedContent = content;
    if (content.length > familyBudget) {
      const { preview, filePath, originalSize } = persistLargeResult(toolName, toolCallId, content);
      trimmedContent = buildPersistedContent(filePath, preview, originalSize);
    }

    const entry: TrackedResult = {
      id: `tr_${this.nextId++}`,
      toolName,
      toolCallId,
      content: trimmedContent,
      originalSize: content.length,
      turn,
      spilledToDisk: trimmedContent !== content,
      trimmed: trimmedContent !== content,
    };

    this.results.push(entry);
    this.enforce();
    return entry;
  }

  /**
   * Enforce the conversation budget by trimming oldest results.
   */
  private enforce(): void {
    let totalChars = this.results.reduce((sum, r) => sum + r.content.length, 0);

    if (totalChars <= this.budgetChars) return;

    // Sort by turn (oldest first), but protect recent results
    const trimmable = this.results.slice(0, -MIN_KEEP_RECENT);

    for (const entry of trimmable) {
      if (totalChars <= this.budgetChars) break;
      if (entry.trimmed) continue; // Already trimmed

      const savedChars = entry.content.length;

      // If large enough, spill to disk first
      if (entry.content.length > PREVIEW_CHARS * 2 && !entry.spilledToDisk) {
        const { preview, filePath, originalSize } = persistLargeResult(
          entry.toolName,
          entry.toolCallId,
          entry.content,
        );
        entry.content = buildPersistedContent(filePath, preview, originalSize);
        entry.spilledToDisk = true;
      } else {
        // Small result — just replace with marker
        entry.content = TRIMMED_MARKER;
      }

      entry.trimmed = true;
      totalChars -= savedChars - entry.content.length;
    }
  }

  /**
   * Get the current content for a tracked result (may be trimmed).
   */
  getContent(id: string): string | undefined {
    return this.results.find((r) => r.id === id)?.content;
  }

  /**
   * Budget statistics.
   */
  stats(): BudgetStats {
    const totalChars = this.results.reduce((sum, r) => sum + r.content.length, 0);
    return {
      totalChars,
      budgetChars: this.budgetChars,
      usageFraction: totalChars / this.budgetChars,
      trackedResults: this.results.length,
      trimmedResults: this.results.filter((r) => r.trimmed).length,
      spilledResults: this.results.filter((r) => r.spilledToDisk).length,
    };
  }

  /** Reset (new session). */
  reset(): void {
    this.results = [];
    this.nextId = 0;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ConversationBudget | null = null;

export function getConversationBudget(budgetChars?: number): ConversationBudget {
  if (!instance) instance = new ConversationBudget(budgetChars);
  return instance;
}

export function resetConversationBudget(): void {
  instance = null;
}
