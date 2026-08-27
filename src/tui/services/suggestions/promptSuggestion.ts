// ============================================================================
// Prompt Suggestion — AI-generated next-action suggestions
// ============================================================================

interface Message {
  role?: string;
  content?: string;
  variant?: string;
}

export function generateSuggestions(messages: Message[], positions: any[]): string[] {
  const suggestions: string[] = [];
  const lastMsg = messages[messages.length - 1];

  if (positions.length > 0 && !messages.some((m) => m.content?.includes("/positions"))) {
    suggestions.push("Check positions P&L");
  }
  if (lastMsg?.variant === "strategy" || lastMsg?.content?.includes("signal")) {
    suggestions.push("Analyze the signal in detail");
  }
  if (lastMsg?.content?.includes("filled") || lastMsg?.variant === "fill") {
    suggestions.push("Review trade outcome");
  }
  if (suggestions.length === 0) {
    suggestions.push("Scan markets for opportunities");
  }
  return suggestions.slice(0, 3);
}
