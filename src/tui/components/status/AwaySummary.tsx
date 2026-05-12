import React from "react";
import { Box, Text } from "../../ink-custom";

// Away summary — shows what happened while user was idle/away
// "While you were away: BTC +2.3%, ETH -1.1%, 1 stop hit"
interface AwaySummaryItem {
  type: "price_change" | "position_event" | "alert" | "autonomous";
  text: string;
  color?: string;
}

interface Props {
  items: AwaySummaryItem[];
  awayDuration: string;
  onDismiss: () => void;
}

export function AwaySummary({ items, awayDuration, onDismiss }: Props) {
  if (items.length === 0) return null;

  return (
    <Box flexDirection="column" paddingX={2} marginBottom={1} borderStyle="single" borderColor="gray">
      <Box>
        <Text dimColor>While you were away ({awayDuration}):</Text>
      </Box>
      {items.map((item, i) => (
        <Box key={i} paddingLeft={2}>
          <Text color={item.color as any ?? undefined}>{"\u2022"} {item.text}</Text>
        </Box>
      ))}
      <Text dimColor>  Press any key to dismiss</Text>
    </Box>
  );
}
