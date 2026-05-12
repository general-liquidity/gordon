// ============================================================================
// Conversation Branch — Fork conversation at any message point
// ============================================================================

interface Message { id?: string; role?: string; content?: string; timestamp?: number; }
export interface BranchResult { branchId: string; messages: Message[]; parentSessionId: string; }

export function branchConversation(messages: Message[], forkAtIndex: number, sessionId = "main"): BranchResult {
  return {
    branchId: `branch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    messages: messages.slice(0, forkAtIndex + 1),
    parentSessionId: sessionId,
  };
}
