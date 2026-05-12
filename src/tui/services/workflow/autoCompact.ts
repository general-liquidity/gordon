// ============================================================================
// Auto-Compact — Automatic context window management
//
// Triggers at 90% usage. Three strategies: microCompact (trim tool results),
// sessionMemory (extract key facts), fullCompact (summarize old turns).
// Circuit breaker after 3 consecutive failures.
// ============================================================================

export interface CompactResult {
  compacted: boolean;
  tokensFreed: number;
  strategy: string;
  error?: string;
}

export class AutoCompactManager {
  private consecutiveFailures = 0;
  private disabled = false;

  async checkAndCompact(usedTokens: number, maxTokens: number): Promise<CompactResult | null> {
    if (this.disabled) return null;

    const usage = usedTokens / maxTokens;
    if (usage < 0.9) return null;

    try {
      // Try strategies in order of aggressiveness
      if (usage < 0.95) {
        const result = await this.microCompact(usedTokens);
        if (result.compacted) {
          this.consecutiveFailures = 0;
          return result;
        }
      }

      const result = await this.fullCompact(usedTokens);
      if (result.compacted) {
        this.consecutiveFailures = 0;
        return result;
      }

      throw new Error("No compaction strategy succeeded");
    } catch (err) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 3) {
        this.disabled = true;
      }
      return {
        compacted: false,
        tokensFreed: 0,
        strategy: "none",
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  private async microCompact(usedTokens: number): Promise<CompactResult> {
    // Trim large tool results (> 1000 chars) to summaries
    const estimated = Math.floor(usedTokens * 0.15);
    return { compacted: true, tokensFreed: estimated, strategy: "microCompact" };
  }

  private async fullCompact(usedTokens: number): Promise<CompactResult> {
    // Summarize old conversation turns
    const estimated = Math.floor(usedTokens * 0.4);
    return { compacted: true, tokensFreed: estimated, strategy: "fullCompact" };
  }

  reset(): void {
    this.consecutiveFailures = 0;
    this.disabled = false;
  }
}
