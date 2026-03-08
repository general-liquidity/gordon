import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./theme.ts";
import {
  getGordonLoaderColor,
  getGordonLoadingPhrases,
  useGordonLoader,
} from "./components/GordonLoader.tsx";
import { MarkdownText } from "./components/MarkdownText.tsx";
import { formatHiddenMessageNotice } from "./threadDensity.ts";

export interface ChatMessage {
  role: "user" | "gordon";
  content: string;
  timestamp?: string;
  agent?: string;
  badge?: string;
}

interface ChatViewProps {
  messages: ChatMessage[];
  hiddenCount?: number;
  visibleLimit?: number;
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

  return (
    <Box
      flexDirection="column"
      marginY={0}
      paddingX={1}
      alignSelf={isUser ? "flex-end" : "flex-start"}
    >
      {/* Role label */}
      <Box>
        <Text color={isUser ? COLORS.DIM : COLORS.TAN} bold>
          {isUser ? "You" : "Gordon"}
        </Text>
        {message.badge && (
          <Text color={COLORS.HIGHLIGHT}> [{message.badge}]</Text>
        )}
        {showAgentBadge && (
          <Text color="cyan" dimColor> via {message.agent}</Text>
        )}
        {message.timestamp && (
          <Text color={COLORS.DIM}> {message.timestamp}</Text>
        )}
      </Box>

      {/* Message content */}
      <Box
        borderStyle="round"
        borderColor={isUser ? COLORS.DIM : isStreamingMessage ? COLORS.HIGHLIGHT : COLORS.TAN_DIM}
        paddingX={1}
        marginLeft={isUser ? 4 : 0}
        marginRight={isUser ? 0 : 4}
        flexDirection="column"
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
      </Box>
    </Box>
  );
});

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  hiddenCount = 0,
  visibleLimit,
  isStreaming = false,
  activeStreamingTimestamp = null,
  activityStatus = null,
  activeToolCall = null,
}) => {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {messages.length === 0 ? (
        <Box justifyContent="center" paddingY={2}>
          <Text color={COLORS.DIM} italic>
            Ask Gordon to scan, analyze, plan, or review a market.
          </Text>
        </Box>
      ) : (
        <>
          {hiddenCount > 0 && (
            <Box paddingX={1} paddingY={0}>
              <Text color={COLORS.DIM}>
                {formatHiddenMessageNotice(hiddenCount, visibleLimit ?? messages.length)}
              </Text>
            </Box>
          )}
          {messages.map((msg, index) => (
            <MessageBubble
              key={`${index}-${msg.role}-${msg.timestamp ?? "no-ts"}-${msg.agent ?? "gordon"}-${msg.badge ?? ""}`}
              message={msg}
              isStreamingMessage={
                isStreaming
                && msg.role === "gordon"
                && activeStreamingTimestamp !== null
                && msg.timestamp === activeStreamingTimestamp
              }
              activityStatus={activityStatus}
              activeToolCall={activeToolCall}
            />
          ))}
        </>
      )}
    </Box>
  );
};

export default ChatView;
