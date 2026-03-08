import {
  formatPromptContextReport,
  getLatestPromptContextReport,
} from "../../infra/agents/contextBudget.ts";

export interface ContextCommandResult {
  success: boolean;
  message: string;
}

export async function handleContextCommand(args: string, currentThreadId?: string): Promise<ContextCommandResult> {
  const threadId = args.trim() || currentThreadId;
  const report = getLatestPromptContextReport(threadId);
  return {
    success: report !== null,
    message: formatPromptContextReport(report),
  };
}
