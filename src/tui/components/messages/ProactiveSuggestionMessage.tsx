import React from "react";
import { Box, Text } from "ink";
import { RichContent } from "../RichContent.js";
import type { Message } from "../MessageBubble.js";

// Proactive suggestion card: Gordon's unsolicited suggestions when proactive
// mode is enabled. Visually distinct from trade events — these are
// advisory, not confirmations of fills. Accept / dismiss via tools or
// slash commands.

const CATEGORY_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  regime_flip:        { icon: "\u21C4", color: "magenta",    label: "REGIME FLIP" },
  whale_alert:        { icon: "\u25C9", color: "yellowBright", label: "WHALE MOVE" },
  volatility_spike:   { icon: "\u25B2", color: "red",        label: "VOLATILITY" },
  stop_loss_tighten:  { icon: "\u25BC", color: "red",        label: "STOP" },
  portfolio_drift:    { icon: "\u25A0", color: "blue",       label: "DRIFT" },
  missed_entry:       { icon: "\u203B", color: "cyanBright", label: "MISSED LEVEL" },
  position_review:    { icon: "\u25CE", color: "cyan",       label: "REVIEW" },
  journal_prompt:     { icon: "\u270E", color: "gray",       label: "JOURNAL" },
  session_review:     { icon: "\u29BF", color: "gray",       label: "SESSION" },
  risk_warning:       { icon: "\u26A0", color: "redBright",  label: "RISK" },
  playbook_suggest:   { icon: "\u2756", color: "greenBright", label: "PLAYBOOK" },
  funding_alert:      { icon: "\u00A4", color: "yellow",     label: "FUNDING" },
  news_event:         { icon: "\u00B6", color: "whiteBright", label: "NEWS" },
  default:            { icon: "\u25C6", color: "greenBright", label: "PROACTIVE" },
};

interface ProactiveSuggestionProps {
  message: Message;
}

export function ProactiveSuggestionMessage({ message }: ProactiveSuggestionProps) {
  const category = message.badge?.split(":")[0] ?? "default";
  const id = message.badge?.split(":")[1] ?? "";
  const confidence = message.badge?.split(":")[2] ?? "";
  const config = CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.default!;

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={config.color} paddingX={1}>
      <Box>
        <Text color={config.color}>{config.icon} </Text>
        <Text bold color={config.color}>{config.label}</Text>
        <Text dimColor> {"\u00b7"} proactive</Text>
        {confidence && (
          <Text dimColor> {"\u00b7"} conf {confidence}</Text>
        )}
        {id && (
          <Text dimColor> {"\u00b7"} {id.slice(0, 10)}</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <RichContent content={message.content} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>/ack {id.slice(0, 10)}</Text>
        <Text dimColor>  {"\u00b7"}  </Text>
        <Text dimColor>/pass {id.slice(0, 10)}</Text>
        <Text dimColor>  {"\u00b7"}  </Text>
        <Text dimColor>/snooze {category}</Text>
      </Box>
    </Box>
  );
}
