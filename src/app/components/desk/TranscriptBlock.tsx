import React from "react";
import { Box, Text, useStdout } from "ink";
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
  const { stdout } = useStdout();
  const terminalColumns = stdout?.columns ?? 120;
  const ruleWidth = Math.max(10, Math.min(terminalColumns - (isUser ? 44 : 28), 28));
  const headerRule = "─".repeat(ruleWidth);
  const leadGlyph = variant === "approval" || variant === "execution"
    ? "┃"
    : variant === "tool" || variant === "system"
      ? "▏"
      : "│";
  const headerColor = isStreaming ? COLORS.MONEY : tokens.label;
  const userWidth = terminalColumns >= 150 ? "68%" : terminalColumns >= 110 ? "72%" : "78%";
  const userMarginLeft = Math.max(6, Math.min(18, Math.floor(terminalColumns * 0.12)));

  return (
    <Box
      flexDirection="column"
      alignSelf={isUser ? "flex-end" : "flex-start"}
      width={isUser ? userWidth : undefined}
      marginBottom={1}
    >
      <Box
        flexDirection="column"
        marginLeft={isUser ? userMarginLeft : 0}
        marginRight={isUser ? 0 : 2}
      >
        <Box>
          <Text color={headerColor} bold>
            {title.toUpperCase()}
          </Text>
          {badge && (
            <Text color={headerColor}> [{badge}]</Text>
          )}
          {agent && (
            <Text color={COLORS.DIM}> · via {agent}</Text>
          )}
          {timestamp && (
            <Text color={COLORS.DIM}> · {timestamp}</Text>
          )}
          <Text color={isStreaming ? COLORS.MONEY : tokens.border}> {headerRule}</Text>
        </Box>
        <Box marginTop={1} flexDirection="row">
          <Text color={isStreaming ? COLORS.MONEY : tokens.accent}>
            {leadGlyph}
          </Text>
          <Box marginLeft={1} flexDirection="column" flexGrow={1}>
            {children}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default TranscriptBlock;
