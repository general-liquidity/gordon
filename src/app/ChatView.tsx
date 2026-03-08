import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./theme.ts";
import {
  getGordonLoaderColor,
  getGordonLoadingPhrases,
  useGordonLoader,
} from "./components/GordonLoader.tsx";
import { MarkdownText } from "./components/MarkdownText.tsx";
import { formatHiddenMessageNotice, formatHiddenNewerNotice } from "./threadDensity.ts";

export interface ChatMessage {
  role: "user" | "gordon";
  content: string;
  timestamp?: string;
  agent?: string;
  badge?: string;
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
  isStreamingMessage?: boolean;
  activityStatus?: string | null;
  activeToolCall?: string | null;
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
  isStreamingMessage = false,
  activityStatus,
  activeToolCall,
}) => {
  const isUser = message.role === "user";
  const showAgentBadge = !isUser && message.agent && message.agent.toLowerCase() !== "gordon";
  const roleLabel = isUser ? "You" : "Gordon";
  const metaColor = isUser ? COLORS.DIM : COLORS.TAN;

  return (
    <Box
      flexDirection="column"
      marginY={0}
      paddingX={0}
      alignSelf={isUser ? "flex-end" : "flex-start"}
    >
      {/* Message content */}
      <Box
        borderStyle="round"
        borderColor={isUser ? COLORS.DIM : isStreamingMessage ? COLORS.HIGHLIGHT : COLORS.TAN_DIM}
        paddingX={1}
        marginLeft={isUser ? 2 : 0}
        marginRight={isUser ? 0 : 2}
        flexDirection="column"
      >
        <Box>
          <Text color={metaColor} bold>{roleLabel}</Text>
          {message.badge && (
            <Text color={COLORS.HIGHLIGHT}> [{message.badge}]</Text>
          )}
          {showAgentBadge && (
            <Text color={COLORS.CYAN} dimColor> via {message.agent}</Text>
          )}
          {message.timestamp && (
            <Text color={COLORS.DIM}> {` · ${message.timestamp}`}</Text>
          )}
        </Box>
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
      </Box>
    </Box>
  );
});

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  hiddenBefore = 0,
  hiddenAfter = 0,
  visibleLimit,
  isPinnedBottom = true,
  isStreaming = false,
  activeStreamingTimestamp = null,
  activityStatus = null,
  activeToolCall = null,
}) => {
  const renderedMessages = messages
    .map((message, index) => ({ message, index }))
    .map(({ message, index }) => {
      const isStreamingMessage =
        isStreaming
        && message.role === "gordon"
        && activeStreamingTimestamp !== null
        && message.timestamp === activeStreamingTimestamp;

      return (
        <MessageBubble
          key={`${index}-${message.role}-${message.timestamp ?? "no-ts"}-${message.agent ?? "gordon"}-${message.badge ?? ""}`}
          message={message}
          isStreamingMessage={isStreamingMessage}
          activityStatus={isStreamingMessage ? activityStatus : null}
          activeToolCall={isStreamingMessage ? activeToolCall : null}
        />
      );
    });

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={0}>
      {messages.length > 0 && (
        <>
          {hiddenBefore > 0 && (
            <Box paddingX={0} paddingY={0}>
              <Text color={COLORS.DIM}>
                {formatHiddenMessageNotice(hiddenBefore, visibleLimit ?? messages.length)}
              </Text>
            </Box>
          )}
          {renderedMessages}
          {hiddenAfter > 0 && (
            <Box paddingX={0} paddingY={0}>
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
};

export default ChatView;
