import { useMemo } from "react";
import type { Message } from "../components/MessageBubble.js";

// Prompt suggestions — suggest next action based on conversation context
// Trading-adapted: suggests /scan, /dd, /risk-check based on what happened

interface Suggestion {
  command: string;
  label: string;
}

export function usePromptSuggestions(
  messages: Message[],
  isStreaming: boolean,
  hasExchange: boolean,
): Suggestion[] {
  return useMemo(() => {
    if (isStreaming || messages.length === 0) return [];

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) return [];
    const content = lastMsg.content.toLowerCase();

    const suggestions: Suggestion[] = [];

    // After a scan result → suggest deep dive
    if (lastMsg.variant === "scan_result" || content.includes("opportunit") || content.includes("trending")) {
      suggestions.push({ command: "/dd", label: "Deep dive on a symbol" });
    }

    // After analysis → suggest risk check or trade
    if (content.includes("support") || content.includes("resistance") || content.includes("bullish") || content.includes("bearish")) {
      suggestions.push({ command: "/risk-check", label: "Check risk before trading" });
      if (hasExchange) {
        suggestions.push({ command: "/swing-entry", label: "Set up a swing trade" });
      }
    }

    // After a trade → suggest monitoring
    if (lastMsg.variant === "fill" || content.includes("executed") || content.includes("filled")) {
      suggestions.push({ command: "/positions", label: "Check open positions" });
    }

    // After risk check → suggest execution or adjustment
    if (lastMsg.variant === "risk_check") {
      if (content.includes("pass")) {
        suggestions.push({ command: "/swing-entry", label: "Proceed with entry" });
      } else {
        suggestions.push({ command: "/rebalance", label: "Rebalance portfolio" });
      }
    }

    // Default suggestions when idle
    if (suggestions.length === 0 && messages.length <= 2) {
      suggestions.push(
        { command: "/morning-brief", label: "Market overview" },
        { command: "/quick-scan", label: "Scan for opportunities" },
      );
    }

    return suggestions.slice(0, 3);
  }, [messages, isStreaming, hasExchange]);
}
