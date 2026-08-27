// ============================================================================
// Extract Memories — Auto-extract trading learnings from conversations
// ============================================================================

interface Message {
  role?: string;
  content?: string;
}

export interface ExtractedMemory {
  type: "user" | "feedback" | "project" | "reference";
  content: string;
  confidence: number;
}

export function extractMemoriesFromConversation(messages: Message[]): ExtractedMemory[] {
  if (messages.length < 20) return [];

  const results: ExtractedMemory[] = [];
  for (const msg of messages) {
    const text = msg.content ?? "";
    if (/\b(I prefer|I always|I never|I like to)\b/i.test(text)) {
      results.push({ type: "user", content: text.slice(0, 200), confidence: 0.7 });
    }
    if (/\b(don't do|stop|not that|wrong|incorrect)\b/i.test(text) && msg.role === "user") {
      results.push({ type: "feedback", content: text.slice(0, 200), confidence: 0.8 });
    }
    if (/\b(we're working on|the goal is|deadline|milestone)\b/i.test(text)) {
      results.push({ type: "project", content: text.slice(0, 200), confidence: 0.6 });
    }
  }
  return results.slice(0, 10);
}
