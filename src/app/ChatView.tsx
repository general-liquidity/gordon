import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./theme.ts";
import {
  getGordonLoaderColor,
  getGordonLoadingPhrases,
  useGordonLoader,
} from "./components/GordonLoader.tsx";
import { MarkdownText } from "./components/MarkdownText.tsx";
import { TranscriptBlock, type TranscriptVariant } from "./components/desk/TranscriptBlock.tsx";
import { formatHiddenMessageNotice, formatHiddenNewerNotice } from "./threadDensity.ts";

export type ChatMessageVariant = TranscriptVariant;

export interface ChatMessage {
  role: "user" | "gordon";
  content: string;
  timestamp?: string;
  agent?: string;
  badge?: string;
  variant?: ChatMessageVariant;
}

interface ChatViewProps {
  messages: ChatMessage[];
  hiddenBefore?: number;
  hiddenAfter?: number;
  visibleLimit?: number;
  isPinnedBottom?: boolean;
  isStreaming?: boolean;
  activeStreamingTimestamp?: string | null;
  activityStatus?: string | null;
  activeToolCall?: string | null;
}

interface MessageBubbleProps {
  message: ChatMessage;
  variant: ChatMessageVariant;
  isStreamingMessage?: boolean;
  activityStatus?: string | null;
  activeToolCall?: string | null;
}

export function inferMessageVariant(message: ChatMessage): ChatMessageVariant {
  if (message.variant) {
    return message.variant;
  }

  if (message.role === "user") {
    return "user";
  }

  const badge = message.badge?.toLowerCase() ?? "";
  const agent = message.agent?.toLowerCase() ?? "";

  if (agent.includes("critic")) return "critic";
  if (agent.includes("auditor")) return "auditor";
  if (badge.includes("approval")) return "approval";
  if (badge.includes("signal") || badge.includes("scan")) return "signal";
  if (badge.includes("execution") || badge.includes("order") || badge.includes("fill")) return "execution";
  if (badge.includes("tool") || badge.includes("plugin") || badge.includes("mcp")) return "tool";
  if (badge.includes("system") || badge.includes("runtime")) return "system";
  if (badge.includes("handoff")) return "handoff";

  return "gordon";
}

export function normalizeChatMessage(message: ChatMessage): ChatMessage {
  const variant = inferMessageVariant(message);
  return {
    ...message,
    variant,
  };
}

function buildMessageSignature(messages: ChatMessage[]): string {
  return messages
    .map((message) => [
      message.role,
      message.timestamp ?? "",
      message.variant ?? "",
      message.agent ?? "",
      message.badge ?? "",
      message.content.length,
    ].join(":"))
    .join("|");
}

function getMessageKey(message: ChatMessage): string {
  return [
    message.role,
    message.timestamp ?? "",
    message.variant ?? "",
    message.agent ?? "",
    message.badge ?? "",
    message.content.slice(0, 96),
  ].join(":");
}

const StreamingStateLine: React.FC<{
  message: ChatMessage;
  activityStatus?: string | null;
  activeToolCall?: string | null;
}> = ({ message, activityStatus, activeToolCall }) => {
  const { glyph, phrase, cursorVisible } = useGordonLoader({
    phrases: getGordonLoadingPhrases({
      currentTool: activeToolCall,
      activityStatus,
      variant: "response",
    }),
  });
  const loaderColor = getGordonLoaderColor({
    currentTool: activeToolCall,
    activityStatus,
    variant: "response",
  });
  const liveStatus = activeToolCall
    ? `Running ${activeToolCall}`
    : activityStatus || phrase;

  return (
    <Box flexDirection="column">
      {message.content.trim().length > 0 ? (
        <MarkdownText>{message.content}</MarkdownText>
      ) : (
        <Box>
          <Text color={loaderColor}>{glyph}</Text>
          <Text color={COLORS.DIM}> {phrase}...</Text>
        </Box>
      )}
      <Box marginTop={message.content.trim().length > 0 ? 1 : 0}>
        <Text color={loaderColor}>{glyph}</Text>
        <Text color={COLORS.DIM}> {liveStatus}</Text>
        <Text color={loaderColor}>{cursorVisible ? " ▋" : "  "}</Text>
      </Box>
    </Box>
  );
};

const MessageBubble: React.FC<MessageBubbleProps> = React.memo(({
  message,
  variant,
  isStreamingMessage = false,
  activityStatus,
  activeToolCall,
}) => {
  const isUser = variant === "user";
  const showAgentBadge = !isUser && message.agent && message.agent.toLowerCase() !== "gordon";
  const roleLabel = variant === "user"
    ? "You"
    : variant === "tool"
      ? "Tool"
      : variant === "system"
        ? "System"
        : variant === "approval"
          ? "Approval Ticket"
          : variant === "signal"
            ? "Signal"
            : variant === "execution"
              ? "Execution"
              : variant === "critic"
                ? "Critic"
                : variant === "auditor"
                  ? "Auditor"
                  : variant === "handoff"
                    ? "Handoff"
                    : "Gordon";

  return (
    <TranscriptBlock
      variant={variant}
      title={roleLabel}
      timestamp={message.timestamp}
      badge={message.badge}
      agent={showAgentBadge ? message.agent : undefined}
      isStreaming={isStreamingMessage}
    >
      {isUser ? (
        <Text color={COLORS.WHITE} wrap="wrap">
          {message.content}
        </Text>
      ) : isStreamingMessage ? (
        <StreamingStateLine
          message={message}
          activityStatus={activityStatus}
          activeToolCall={activeToolCall}
        />
      ) : (
        <MarkdownText>{message.content}</MarkdownText>
      )}
    </TranscriptBlock>
  );
});

export const ChatView = React.memo(({
  messages,
  hiddenBefore = 0,
  hiddenAfter = 0,
  visibleLimit,
  isPinnedBottom = true,
  isStreaming = false,
  activeStreamingTimestamp = null,
  activityStatus = null,
  activeToolCall = null,
}: ChatViewProps) => {
  const renderedMessages = React.useMemo(() => messages
    .map((message) => {
      const variant = inferMessageVariant(message);
      const isStreamingMessage =
        isStreaming
        && message.role === "gordon"
        && activeStreamingTimestamp !== null
        && message.timestamp === activeStreamingTimestamp;

      return (
        <MessageBubble
          key={getMessageKey(message)}
          message={message}
          variant={variant}
          isStreamingMessage={isStreamingMessage}
          activityStatus={isStreamingMessage ? activityStatus : null}
          activeToolCall={isStreamingMessage ? activeToolCall : null}
        />
      );
    }), [messages, isStreaming, activeStreamingTimestamp, activityStatus, activeToolCall]);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {messages.length > 0 && (
        <>
          {hiddenBefore > 0 && (
            <Box paddingX={1} paddingY={0}>
              <Text color={COLORS.DIM}>
                {formatHiddenMessageNotice(hiddenBefore, visibleLimit ?? messages.length)}
              </Text>
            </Box>
          )}
          {renderedMessages}
          {hiddenAfter > 0 && (
            <Box paddingX={1} paddingY={0}>
              <Text color={COLORS.DIM}>
                {formatHiddenNewerNotice(hiddenAfter)}
                {!isPinnedBottom ? " Use PgDn or End to jump back to the live edge." : ""}
              </Text>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}, (previous, next) => (
  previous.hiddenBefore === next.hiddenBefore
  && previous.hiddenAfter === next.hiddenAfter
  && previous.visibleLimit === next.visibleLimit
  && previous.isPinnedBottom === next.isPinnedBottom
  && previous.isStreaming === next.isStreaming
  && previous.activeStreamingTimestamp === next.activeStreamingTimestamp
  && previous.activityStatus === next.activityStatus
  && previous.activeToolCall === next.activeToolCall
  && buildMessageSignature(previous.messages) === buildMessageSignature(next.messages)
));

export default ChatView;
