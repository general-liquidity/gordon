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
  hiddenCount?: number;
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
  hiddenCount = 0,
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
            <MessageBubble key={`${msg.role}-${msg.timestamp}-${hiddenCount + index}`} message={msg} />
          ))}
        </>
      )}
    </Box>
  );
};

export default ChatView;
