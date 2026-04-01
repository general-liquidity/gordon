import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../../theme.ts";
import { getDeskToneTokens, type DeskTone } from "./DeskPanel.tsx";

export type TranscriptVariant =
  | "user"
  | "gordon"
  | "tool"
  | "system"
  | "approval"
  | "signal"
  | "execution"
  | "critic"
  | "auditor"
  | "handoff";

function getTranscriptTone(variant: TranscriptVariant): DeskTone {
  switch (variant) {
    case "approval":
      return "warning";
    case "signal":
      return "brand";
    case "execution":
      return "success";
    case "tool":
    case "system":
      return "info";
    case "critic":
    case "auditor":
      return "analysis";
    case "handoff":
      return "operate";
    case "user":
      return "neutral";
    case "gordon":
    default:
      return "brand";
  }
}

interface TranscriptBlockProps {
  variant: TranscriptVariant;
  title: string;
  timestamp?: string;
  badge?: string;
  agent?: string;
  isStreaming?: boolean;
  children: React.ReactNode;
}

export function TranscriptBlock({
  variant,
  title,
  timestamp,
  badge,
  agent,
  isStreaming = false,
  children,
}: TranscriptBlockProps): React.ReactElement {
  const tone = getTranscriptTone(variant);
  const tokens = getDeskToneTokens(tone);
  const isUser = variant === "user";
  const borderStyle = variant === "approval" || variant === "execution" ? "double" : "single";

  return (
    <Box
      flexDirection="column"
      alignSelf={isUser ? "flex-end" : "flex-start"}
      width={isUser ? "80%" : undefined}
      marginBottom={1}
    >
      <Box
        flexDirection="column"
        borderStyle={borderStyle}
        borderColor={isStreaming ? COLORS.MONEY : tokens.border}
        paddingX={1}
        paddingY={0}
        marginLeft={isUser ? 4 : 0}
        marginRight={isUser ? 0 : 2}
      >
        <Box>
          <Text color={tokens.label} bold>
            {title.toUpperCase()}
          </Text>
          {badge && (
            <Text color={tokens.label}> [{badge}]</Text>
          )}
          {agent && (
            <Text color={COLORS.DIM}> · via {agent}</Text>
          )}
          {timestamp && (
            <Text color={COLORS.DIM}> · {timestamp}</Text>
          )}
        </Box>
        <Box marginTop={1} flexDirection="column">
          {children}
        </Box>
      </Box>
    </Box>
  );
}

export default TranscriptBlock;
