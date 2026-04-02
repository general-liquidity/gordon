import React from "react";
import { Box, Text } from "ink";

import { COLORS } from "./theme.ts";

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

function getMessageTone(message: ChatMessage): { border: string; label: string } {
  if (message.role === "user") return { border: COLORS.ICE, label: "YOU" };
  if (message.variant === "approval") return { border: COLORS.AMBER, label: "APPROVAL" };
  if (message.variant === "queued") return { border: COLORS.BRASS, label: "QUEUED" };
  if (message.role === "system") return { border: COLORS.BRASS_DIM, label: "SYSTEM" };
  return { border: COLORS.MONEY, label: "GORDON" };
}

export const ChatView: React.FC<{
  messages: ChatMessage[];
  hiddenBefore?: number;
  hiddenAfter?: number;
  isPinnedBottom?: boolean;
  activeStreamingTimestamp?: string | null;
}> = ({
  messages,
  hiddenBefore = 0,
  hiddenAfter = 0,
  isPinnedBottom = true,
  activeStreamingTimestamp,
}) => {
  const columns = process.stdout.columns ?? 120;
  const bubbleWidth = Math.max(48, Math.min(96, Math.floor(columns * 0.76)));
  const userOffset = Math.max(0, columns - bubbleWidth - 8);

  return (
    <Box flexDirection="column">
      {hiddenBefore > 0 ? <Text color={COLORS.DIM}>... {hiddenBefore} earlier messages above</Text> : null}
      {messages.map((entry, index) => {
        const message = normalizeChatMessage(entry);
        const tone = getMessageTone(message);
        const isUser = message.role === "user";
        const isStreaming = Boolean(activeStreamingTimestamp && message.timestamp === activeStreamingTimestamp);
        return (
          <Box
            key={`${message.timestamp ?? "message"}:${index}:${message.content.slice(0, 24)}`}
            marginBottom={1}
            marginLeft={isUser ? userOffset : 0}
            width={bubbleWidth}
            flexDirection="column"
            borderStyle="round"
            borderColor={tone.border}
            paddingX={1}
          >
            <Box justifyContent="space-between">
              <Text color={tone.border} bold>
                {tone.label}
                {message.badge ? <Text color={COLORS.DIM}> [{message.badge}]</Text> : null}
                {message.agent ? <Text color={COLORS.DIM}> · {message.agent}</Text> : null}
              </Text>
              <Text color={COLORS.DIM}>{message.timestamp ?? ""}{isStreaming ? "  live" : ""}</Text>
            </Box>
            <Text color={COLORS.WHITE}>{message.content}</Text>
          </Box>
        );
      })}
      {hiddenAfter > 0 ? <Text color={COLORS.DIM}>... {hiddenAfter} newer messages below</Text> : null}
      {!isPinnedBottom ? <Text color={COLORS.BRASS_DIM}>transcript detached from live edge</Text> : null}
    </Box>
  );
};
