import React from "react";
import { Box, Text } from "../../ink-custom";
import { RichContent } from "./RichContent.tsx";
import type { Message } from "./MessageBubble.tsx";

// Proactive suggestion card: Gordon's unsolicited suggestions when proactive
// mode is enabled. Visually distinct from trade events — these are
// advisory, not confirmations of fills. Accept / dismiss via tools or
// slash commands.

// Sentinel the delivery policy stamps on a summary-rollup card's title (kept
// in sync with SUMMARY_ROLLUP_MARKER in infra/proactive/types.ts). When the
// batch of normal/low suggestions crosses the threshold, the engine emits one
// rollup through the same proactive:suggestion_fired path instead of flooding
// individual cards; this marker tells the renderer to use the digest variant.
const SUMMARY_ROLLUP_MARKER = "≡"; // ≡

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

export const ProactiveSuggestionMessage = React.memo(function ProactiveSuggestionMessage({ message }: ProactiveSuggestionProps) {
  const category = message.badge?.split(":")[0] ?? "default";
  const id = message.badge?.split(":")[1] ?? "";
  const confidence = message.badge?.split(":")[2] ?? "";

  // A summary-rollup collapses several batched cards into one digest. The
  // engine marks it with SUMMARY_ROLLUP_MARKER at the head of the title
  // (first line of content), so detect it there rather than via category.
  const firstLine = message.content.split("\n", 1)[0] ?? "";
  if (firstLine.trimStart().startsWith(SUMMARY_ROLLUP_MARKER)) {
    return <ProactiveSummaryCard message={message} id={id} />;
  }

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
        <Text dimColor>Ctrl+G focus · then a ack / p pass / d snooze</Text>
        <Text dimColor>  {"\u00b7"}  </Text>
        <Text dimColor>/ack {id.slice(0, 10)} · /pass {id.slice(0, 10)} · /snooze {category}</Text>
      </Box>
    </Box>
  );
});

// ============================================================================
// Summary-rollup card — one digest standing in for a batch of held cards
// ============================================================================

const ROLLUP_COLOR = "cyanBright";

interface ProactiveSummaryProps {
  message: Message;
  id: string;
}

/**
 * Render the batched summary rollup. Body arrives as
 * `"8 pending · news:3 · regime:2 · funding:3"`; we surface the
 * total prominently and chip out each category with its icon so the operator
 * can scan what's queued at a glance. Distinct accent + label from a normal
 * card.
 */
function ProactiveSummaryCard({ message, id }: ProactiveSummaryProps) {
  const lines = message.content.split("\n").filter((l) => l.trim().length > 0);
  // Body is the line after the title that carries the dot-joined breakdown.
  const breakdownLine =
    lines.find((l) => l.includes("·") && /\d/.test(l)) ?? lines[lines.length - 1] ?? "";
  const segments = breakdownLine.split("·").map((s) => s.trim()).filter(Boolean);
  const totalSeg = segments[0] ?? "";
  const categorySegs = segments.slice(1);

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={ROLLUP_COLOR} paddingX={1}>
      <Box>
        <Text color={ROLLUP_COLOR}>{SUMMARY_ROLLUP_MARKER} </Text>
        <Text bold color={ROLLUP_COLOR}>RADAR DIGEST</Text>
        <Text dimColor> {"·"} proactive</Text>
        {totalSeg && <Text dimColor> {"·"} {totalSeg}</Text>}
      </Box>
      <Box marginTop={1} flexWrap="wrap">
        {categorySegs.map((seg, i) => {
          const cat = seg.split(":")[0] ?? "";
          const cfg = CATEGORY_CONFIG[cat] ?? CATEGORY_CONFIG.default!;
          return (
            <Box key={`${cat}-${i}`} marginRight={2}>
              <Text color={cfg.color}>{cfg.icon} </Text>
              <Text color={cfg.color}>{seg}</Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Batched to avoid flooding {"·"} list_proactive_suggestions to expand</Text>
      </Box>
      {id && (
        <Box>
          <Text dimColor>Ctrl+G focus {"·"} /pass {id.slice(0, 10)}</Text>
        </Box>
      )}
    </Box>
  );
}
