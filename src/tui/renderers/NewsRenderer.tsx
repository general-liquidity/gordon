import React from "react";
import { Box, Text } from "../ink-custom";
import { timeAgo } from "../components/charts/DataTable.tsx";

/**
 * NewsRenderer -- Financial news items display
 * SOURCE(badge) TITLE TIME_AGO
 *
 * Renders each news item as a row with colored source badge,
 * article title, and relative timestamp.
 */

interface NewsRow {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  snippet: string;
}

interface Props {
  data: NewsRow[];
}

/** Assign consistent colors to news sources */
const SOURCE_COLORS: Record<string, string> = {
  Reuters: "blue",
  Bloomberg: "magenta",
  CNBC: "yellow",
  "Wall Street Journal": "cyan",
  "Financial Times": "red",
  "Yahoo Finance": "green",
  "MarketWatch": "yellow",
  "The Motley Fool": "blue",
  "Seeking Alpha": "green",
  "Barron's": "cyan",
  CoinDesk: "magenta",
  Decrypt: "green",
  "The Block": "blue",
  TechCrunch: "green",
};

function sourceColor(source: string): string {
  if (SOURCE_COLORS[source]) return SOURCE_COLORS[source]!;
  // Deterministic color from source name
  const colors = ["blue", "magenta", "cyan", "yellow", "green"];
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length]!;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

export function NewsRenderer({ data }: Props) {
  if (data.length === 0) {
    return (
      <Box paddingLeft={2} marginTop={1}>
        <Text dimColor>No news found.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2}>
      {data.map((item, idx) => (
        <Box key={idx} marginBottom={0}>
          {/* Source badge */}
          <Box width={16}>
            <Text color={sourceColor(item.source)} bold>
              {truncate(item.source || "News", 14)}
            </Text>
          </Box>

          {/* Title — with hyperlink if terminal supports OSC 8 */}
          <Box width={52}>
            <Text>
              {item.url ? (
                <Text>
                  {"\u001B]8;;" + item.url + "\u0007"}
                  {truncate(item.title, 50)}
                  {"\u001B]8;;\u0007"}
                </Text>
              ) : (
                truncate(item.title, 50)
              )}
            </Text>
          </Box>

          {/* Relative timestamp */}
          <Box width={10}>
            <Text dimColor>{timeAgo(item.publishedAt)}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
