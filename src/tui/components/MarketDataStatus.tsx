import React from "react";
import { Box, Text } from "../ink-custom";

// ============================================================================
// MarketDataStatus — Market data feed status badge
//
// "feeds: 3 live · 1 degraded" or "feeds: disconnected"
// Green when all live, amber when degraded, red when disconnected.
// Embeddable in FooterHints or any footer row.
// ============================================================================

type FeedStatus = "live" | "degraded" | "disconnected";

interface Feed {
  name: string;
  status: FeedStatus;
}

interface Props {
  feeds: Feed[];
}

export function MarketDataStatus({ feeds }: Props) {
  if (feeds.length === 0) {
    return (
      <Box>
        <Text dimColor>feeds: </Text>
        <Text color="gray">{"\u25CB"} none</Text>
      </Box>
    );
  }

  const liveCt = feeds.filter((f) => f.status === "live").length;
  const degradedCt = feeds.filter((f) => f.status === "degraded").length;
  const disconnectedCt = feeds.filter((f) => f.status === "disconnected").length;

  // Overall color: all live = green, any degraded = yellow, any disconnected = red
  const allDisconnected = disconnectedCt === feeds.length;
  const overallColor = allDisconnected
    ? "red"
    : disconnectedCt > 0 || degradedCt > 0
      ? "yellow"
      : "green";

  const icon = overallColor === "green"
    ? "\u25CF"  // ●
    : overallColor === "yellow"
      ? "\u25C8"  // ◈
      : "\u2717";  // ✗

  // Build summary segments
  const parts: React.ReactNode[] = [];

  if (allDisconnected) {
    parts.push(
      <Text key="disc" color="red">disconnected</Text>
    );
  } else {
    if (liveCt > 0) {
      parts.push(
        <Text key="live" color="green">{liveCt} live</Text>
      );
    }
    if (degradedCt > 0) {
      if (parts.length > 0) parts.push(<Text key="sep1" dimColor> {"\u00b7"} </Text>);
      parts.push(
        <Text key="degraded" color="yellow">{degradedCt} degraded</Text>
      );
    }
    if (disconnectedCt > 0) {
      if (parts.length > 0) parts.push(<Text key="sep2" dimColor> {"\u00b7"} </Text>);
      parts.push(
        <Text key="disconn" color="red">{disconnectedCt} down</Text>
      );
    }
  }

  return (
    <Box>
      <Text dimColor>feeds: </Text>
      <Text color={overallColor}>{icon} </Text>
      {parts}
    </Box>
  );
}
