import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./theme.ts";
import { MarkdownText } from "./components/MarkdownText.tsx";

export interface ChatMessage {
  role: "user" | "gordon";
  content: string;
  timestamp?: string;
  agent?: string;
}

interface ChatViewProps {
  messages: ChatMessage[];
  maxVisibleMessages?: number;
}

interface MessageBubbleProps {
  message: ChatMessage;
}

const MessageBubble: React.FC<MessageBubbleProps> = React.memo(({ message }) => {
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
        borderColor={isUser ? COLORS.DIM : COLORS.TAN_DIM}
        paddingX={1}
        marginLeft={isUser ? 4 : 0}
        marginRight={isUser ? 0 : 4}
        flexDirection="column"
      >
        {isUser ? (
          <Text color={COLORS.WHITE} wrap="wrap">
            {message.content}
          </Text>
        ) : (
          <MarkdownText>{message.content}</MarkdownText>
        )}
      </Box>
    </Box>
  );
});

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  maxVisibleMessages = 15,
}) => {
  // Get the last N messages for display (simulating scroll)
  const visibleMessages = messages.slice(-maxVisibleMessages);

  // Check if there are more messages than visible
  const hasMore = messages.length > maxVisibleMessages;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {/* Scroll indicator */}
      {hasMore && (
        <Box justifyContent="center" marginBottom={1}>
          <Text color={COLORS.DIM}>
            --- {messages.length - maxVisibleMessages} more messages above ---
          </Text>
        </Box>
      )}

      {/* Messages */}
      {visibleMessages.length === 0 ? (
        <Box justifyContent="center" paddingY={2}>
          <Text color={COLORS.DIM} italic>
            Start a conversation with Gordon...
          </Text>
        </Box>
      ) : (
        visibleMessages.map((msg, index) => (
          <MessageBubble key={`${msg.role}-${msg.timestamp}-${index}`} message={msg} />
        ))
      )}
    </Box>
  );
};

export default ChatView;
