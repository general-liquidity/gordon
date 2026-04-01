import { attachCumulativeUsageToPromptReport, attachUsageToPromptReport } from "../contextBudget.ts";
import { recordSessionCostUsage } from "../sessionCostLedger.ts";
import type { GordonContext } from "../types.ts";

export interface NormalizedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export async function resolveNormalizedUsage(
  usage:
    | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    | Promise<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }>
    | undefined,
): Promise<NormalizedUsage> {
  if (!usage) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
  }

  const usageData = usage instanceof Promise ? await usage : usage;
  return {
    promptTokens: usageData.inputTokens || 0,
    completionTokens: usageData.outputTokens || 0,
    totalTokens: usageData.totalTokens || 0,
  };
}

export function recordPromptUsage(
  context: GordonContext,
  threadId: string | undefined,
  usage: NormalizedUsage,
): void {
  const effectiveThreadId = threadId ?? context.threadId;
  attachUsageToPromptReport(effectiveThreadId, usage);

  const ledger = recordSessionCostUsage({
    threadId: effectiveThreadId ?? "default",
    sessionId: context.threadId,
    resourceId: context.userId,
    provider: context.config.modelConfig?.provider ?? process.env.GORDON_PROVIDER,
    model: context.config.modelConfig?.model ?? process.env.GORDON_MODEL ?? null,
    ...usage,
  });

  attachCumulativeUsageToPromptReport(effectiveThreadId, {
    requestCount: ledger.requestCount,
    promptTokens: ledger.promptTokens,
    completionTokens: ledger.completionTokens,
    totalTokens: ledger.totalTokens,
    updatedAt: ledger.updatedAt,
  });
}

