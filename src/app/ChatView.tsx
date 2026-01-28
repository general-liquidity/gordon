import React from "react";
import { Box, Text } from "ink";

// Color palette
const COLORS = {
  TAN: "#d4a27f",
  TAN_DIM: "#b8896a",
  WHITE: "#e8e4de",
  DIM: "#a39e93",
  USER_BG: "#3b3b3b",
  GORDON_BG: "#2d2a26",
} as const;

export interface ChatMessage {
  role: "user" | "gordon";
  content: string;
  timestamp?: string;
}

interface ChatViewProps {
  messages: ChatMessage[];
  maxVisibleMessages?: number;
}

interface MessageBubbleProps {
  message: ChatMessage;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === "user";

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
      >
        <Text color={isUser ? COLORS.WHITE : COLORS.WHITE} wrap="wrap">
          {message.content}
        </Text>
      </Box>
    </Box>
  );
};

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  maxVisibleMessages = 20,
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
          <MessageBubble key={index} message={msg} />
        ))
      )}
    </Box>
  );
};

export default ChatView;
