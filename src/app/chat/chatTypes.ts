export interface ChatMessage {
  role: "user" | "assistant" | "gordon" | "system";
  content: string;
  timestamp?: string;
  badge?: string;
  variant?: "default" | "approval" | "queued" | "system" | "tool" | "handoff";
  agent?: string;
}

export function normalizeChatMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    role: message.role === "assistant" ? "gordon" : message.role,
    content: typeof message.content === "string" ? message.content : String(message.content ?? ""),
  };
}
