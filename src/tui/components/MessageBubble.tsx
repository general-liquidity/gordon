import React from "react";
import { Box, Text } from "ink";
import { RichContent } from "./RichContent.js";
import { Byline } from "./Byline.js";

// ============================================================================
// MessageBubble — Role-prefixed message (Claude Code style: no borders)
//
// 12 variants: default, approval, system, tool, handoff, fill, stop,
//              alert, strategy, error, compact, resume, welcome
// ============================================================================

export type MessageVariant =
  | "default" | "approval" | "system" | "tool" | "handoff"
  | "fill" | "stop" | "alert" | "strategy"
  | "error" | "compact" | "resume" | "welcome";

export interface Message {
  id: string;
  role: "user" | "gordon" | "assistant" | "system";
  content: string;
  timestamp?: string;
  variant?: MessageVariant;
  agent?: string;
  badge?: string;
}

interface Props {
  message: Message;
}

// Badge and color configuration per variant
const VARIANT_CONFIG: Record<string, {
  getBadge: (msg: Message) => string;
  badgeColor: string;
  contentDim?: boolean;
  icon?: string;
}> = {
  default_user: {
    getBadge: () => "YOU",
    badgeColor: "white",
  },
  default_gordon: {
    getBadge: (m) => m.agent ? `GORDON \u00b7 ${m.agent}` : "GORDON",
    badgeColor: "cyanBright",
  },
  approval: {
    getBadge: (m) => `APPROVAL${m.badge ? ` [${m.badge}]` : ""}`,
    badgeColor: "yellow",
    icon: "\u26A0",
  },
  system: {
    getBadge: () => "SYSTEM",
    badgeColor: "cyan",
    contentDim: true,
  },
  tool: {
    getBadge: () => "TOOL",
    badgeColor: "gray",
    contentDim: true,
  },
  handoff: {
    getBadge: (m) => `\u2192 ${m.agent ?? "Agent"}`,
    badgeColor: "cyanBright",
  },
  fill: {
    getBadge: () => "FILLED",
    badgeColor: "green",
    icon: "\u2713",
  },
  stop: {
    getBadge: () => "STOP",
    badgeColor: "red",
    icon: "\u26A0",
  },
  alert: {
    getBadge: () => "ALERT",
    badgeColor: "yellow",
    icon: "!",
  },
  strategy: {
    getBadge: (m) => `STRATEGY${m.agent ? ` \u00b7 ${m.agent}` : ""}`,
    badgeColor: "cyanBright",
    icon: "\u25C8",
  },
  error: {
    getBadge: () => "ERROR",
    badgeColor: "red",
    icon: "\u2717",
  },
  compact: {
    getBadge: () => "\u273B Conversation compacted",
    badgeColor: "gray",
    contentDim: true,
  },
  resume: {
    getBadge: () => "\u21BB Session resumed",
    badgeColor: "gray",
    contentDim: true,
  },
};

export function MessageBubble({ message }: Props) {
  const { role, content, variant = "default", timestamp } = message;

  // Resolve variant key
  const variantKey = variant === "default"
    ? (role === "user" ? "default_user" : "default_gordon")
    : variant;

  const config = VARIANT_CONFIG[variantKey] ?? VARIANT_CONFIG["default_gordon"]!;
  const badgeText = config.getBadge(message);
  const maxLines = config.contentDim ? 5 : 25;

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Badge line */}
      <Box>
        {config.icon && (
          <Text color={config.badgeColor}>{config.icon} </Text>
        )}
        <Text bold color={config.badgeColor}>{badgeText}</Text>
        {timestamp && (
          <>
            <Text> </Text>
            <Byline parts={[timeAgo(timestamp)]} />
          </>
        )}
      </Box>

      {/* Content */}
      {role === "user" ? (
        <Text>{"  "}{content}</Text>
      ) : (
        <RichContent content={content} maxLines={maxLines} />
      )}

      {/* Approval action hints */}
      {variant === "approval" && message.badge && (
        <Box paddingLeft={2}>
          <Text dimColor>
            {"\u2192 approve "}{message.badge}
            {"  \u2502  deny "}{message.badge}
            {"  \u2502  approve "}{message.badge}{" persist"}
          </Text>
        </Box>
      )}
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
  } catch {
    return "";
  }
}
