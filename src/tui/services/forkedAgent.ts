// ============================================================================
// Forked Agent — Spawn isolated agent for side tasks without losing main context
//
// Spawn an isolated agent with fresh context for side tasks
// (memory extraction, verification, side questions) while main conversation
// continues. Parent's cached system prompt is reused for efficiency.
// ============================================================================

export interface ForkedAgentConfig {
  purpose: string; // "memory-extraction" | "verification" | "side-question" | "research"
  prompt: string; // the task prompt
  maxTokens?: number; // default 2000
  inheritContext?: boolean; // inherit parent's last N messages, default false
  inheritMessages?: number; // if inheriting, how many messages (default 5)
}

export interface ForkedAgentResult {
  id: string;
  purpose: string;
  response: string;
  tokensUsed: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

let idCounter = 0;

export class ForkedAgentRunner {
  private running: Map<string, { startedAt: number; purpose: string; abort: AbortController }> =
    new Map();

  async fork(config: ForkedAgentConfig): Promise<ForkedAgentResult> {
    const id = `fork_${++idCounter}_${Date.now()}`;
    const abort = new AbortController();
    const startedAt = Date.now();

    this.running.set(id, { startedAt, purpose: config.purpose, abort });

    try {
      // In production: would call LLM with isolated context
      // For now: simulates by returning a structured placeholder
      const maxTokens = config.maxTokens ?? 2000;

      // Simulate processing time proportional to prompt length
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, Math.min(config.prompt.length, 200));
        abort.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("Forked agent aborted"));
        });
      });

      const durationMs = Date.now() - startedAt;
      const tokensUsed = Math.min(
        Math.floor(config.prompt.length * 0.8),
        maxTokens,
      );

      this.running.delete(id);

      return {
        id,
        purpose: config.purpose,
        response: `[Forked agent "${config.purpose}"] Processed: ${config.prompt.slice(0, 100)}...`,
        tokensUsed,
        durationMs,
        success: true,
      };
    } catch (err: any) {
      this.running.delete(id);
      return {
        id,
        purpose: config.purpose,
        response: "",
        tokensUsed: 0,
        durationMs: Date.now() - startedAt,
        success: false,
        error: err.message ?? "Unknown error",
      };
    }
  }

  getRunning(): Array<{ id: string; purpose: string; elapsed: number }> {
    const now = Date.now();
    return [...this.running.entries()].map(([id, info]) => ({
      id,
      purpose: info.purpose,
      elapsed: now - info.startedAt,
    }));
  }

  abort(id: string): void {
    const entry = this.running.get(id);
    if (entry) {
      entry.abort.abort();
      this.running.delete(id);
    }
  }
}

let instance: ForkedAgentRunner | null = null;

export function getForkedAgentRunner(): ForkedAgentRunner {
  if (!instance) instance = new ForkedAgentRunner();
  return instance;
}
