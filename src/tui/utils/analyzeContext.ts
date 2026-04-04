// ============================================================================
// Context Analysis — Token budget breakdown and suggestions
//
// Estimates token usage per category, detects bloat, generates optimization
// suggestions with savings estimates.
// ============================================================================

export interface ContextAnalysis {
  systemPrompt: number;
  toolDefinitions: number;
  conversation: number;
  memory: number;
  totalUsed: number;
  maxTokens: number;
  usagePercent: number;
  suggestions: Suggestion[];
}

export interface Suggestion {
  title: string;
  savings: number;
  action: string;
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for English text
  return Math.ceil(text.length / 4);
}

export function analyzeContext(
  transcript: Array<{ role?: string; content?: string }>,
  memoryCount: number,
  toolCount: number,
  maxTokens = 200000,
): ContextAnalysis {
  const systemPrompt = 2000; // estimated base system prompt
  const toolDefinitions = toolCount * 150; // ~150 tokens per tool definition

  let conversation = 0;
  for (const msg of transcript) {
    conversation += estimateTokens(msg.content ?? "");
  }

  const memory = memoryCount * 500; // ~500 tokens per memory file
  const totalUsed = systemPrompt + toolDefinitions + conversation + memory;
  const usagePercent = (totalUsed / maxTokens) * 100;

  const suggestions: Suggestion[] = [];

  if (conversation > maxTokens * 0.6) {
    suggestions.push({
      title: "Summarize old conversation turns",
      savings: Math.floor(conversation * 0.4),
      action: "/compact",
    });
  }

  if (memoryCount > 20) {
    suggestions.push({
      title: "Consolidate memory files",
      savings: Math.floor(memory * 0.3),
      action: "/memory consolidate",
    });
  }

  if (toolDefinitions > maxTokens * 0.15) {
    suggestions.push({
      title: "Reduce loaded tool count",
      savings: Math.floor(toolDefinitions * 0.3),
      action: "/tools prune",
    });
  }

  if (usagePercent > 80) {
    suggestions.push({
      title: "Run auto-compact to free context",
      savings: Math.floor(totalUsed * 0.3),
      action: "/compact",
    });
  }

  return { systemPrompt, toolDefinitions, conversation, memory, totalUsed, maxTokens, usagePercent, suggestions };
}
