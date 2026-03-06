import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./theme.ts";
import { getGordonLoadingPhrases, useGordonLoader } from "./components/GordonLoader.tsx";
import { MarkdownText } from "./components/MarkdownText.tsx";

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
  const liveStatus = activeToolCall
    ? `Running ${activeToolCall}`
    : activityStatus || phrase;

  return (
    <Box flexDirection="column">
      {message.content.trim().length > 0 ? (
        <MarkdownText>{message.content}</MarkdownText>
      ) : (
        <Box>
          <Text color={COLORS.HIGHLIGHT}>{glyph}</Text>
          <Text color={COLORS.DIM}> {phrase}...</Text>
        </Box>
      )}
      <Box marginTop={message.content.trim().length > 0 ? 1 : 0}>
        <Text color={COLORS.HIGHLIGHT}>{glyph}</Text>
        <Text color={COLORS.DIM}> {liveStatus}</Text>
        <Text color={COLORS.HIGHLIGHT}>{cursorVisible ? " ▋" : "  "}</Text>
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
            Start a conversation with Gordon...
          </Text>
        </Box>
      ) : (
        <>
          {hiddenCount > 0 && (
            <Box paddingX={1} paddingY={0}>
              <Text color={COLORS.DIM}>
                {hiddenCount} earlier message{hiddenCount === 1 ? "" : "s"} hidden to keep the terminal responsive.
              </Text>
            </Box>
          )}
          {messages.map((msg, index) => (
            <MessageBubble
              key={`${msg.role}-${msg.timestamp}-${hiddenCount + index}`}
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
