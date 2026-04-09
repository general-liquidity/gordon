import React from "react";
import { Box, Text } from "ink";
import { RichContent } from "../RichContent.js";
import { Byline } from "../Byline.js";
import type { Message } from "../MessageBubble.js";

// Trade event messages: FILLED, STOP, ALERT — prominent badges with icons.
// These are money events — the user's trade journal.

const TRADE_CONFIGS: Record<string, { icon: string; color: string; label: string }> = {
  fill:     { icon: "\u2713", color: "green",   label: "FILLED" },
  stop:     { icon: "\u26A0", color: "red",     label: "STOP" },
  alert:    { icon: "!",      color: "yellow",  label: "ALERT" },
  strategy: { icon: "\u25C8", color: "cyanBright", label: "STRATEGY" },
};

export function TradeEventMessage({ message }: { message: Message }) {
  const variant = message.variant ?? "fill";
  const config = TRADE_CONFIGS[variant] ?? TRADE_CONFIGS.fill!;
  const showTimestamp = message.timestamp
    ? (Date.now() - new Date(message.timestamp).getTime()) > 120_000
    : false;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={config.color}>{config.icon} </Text>
        <Text bold color={config.color}>{config.label}</Text>
        {message.agent && (
          <Text dimColor> {"\u00b7"} {message.agent}</Text>
        )}
        {showTimestamp && message.timestamp && (
          <>
            <Text> </Text>
            <Byline parts={[timeAgo(message.timestamp)]} />
          </>
        )}
      </Box>
      <RichContent content={message.content} maxLines={10} />
    </Box>
  );
}

function timeAgo(ts: string): string {
  try {
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch { return ""; }
}
