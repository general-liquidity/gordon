import React from "react";
import { Box, Text } from "ink";

// HighlightedThinkingText — thinking text with optional search query highlights.
// Match segments: bold yellow inverse.
// Non-match segments (and no-query): dimColor.

interface Props {
  text: string;
  query?: string;
}

interface Segment {
  text: string;
  match: boolean;
}

function splitByQuery(text: string, query: string): Segment[] {
  if (!query) return [{ text, match: false }];

  const segments: Segment[] = [];
  let remaining = text;
  const lowerRemaining = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let offset = 0;

  let idx = lowerRemaining.indexOf(lowerQuery);
  while (idx !== -1) {
    if (idx > 0) {
      segments.push({ text: remaining.slice(0, idx), match: false });
    }
    segments.push({ text: remaining.slice(idx, idx + query.length), match: true });
    remaining = remaining.slice(idx + query.length);
    offset += idx + query.length;
    idx = remaining.toLowerCase().indexOf(lowerQuery);
  }

  if (remaining.length > 0) {
    segments.push({ text: remaining, match: false });
  }

  return segments;
}

export function HighlightedThinkingText({ text, query }: Props) {
  if (!query) {
    return (
      <Box>
        <Text dimColor>{text}</Text>
      </Box>
    );
  }

  const segments = splitByQuery(text, query);

  return (
    <Box flexWrap="wrap">
      {segments.map((seg, i) =>
        seg.match ? (
          <Text key={i} bold color="yellow" inverse>{seg.text}</Text>
        ) : (
          <Text key={i} dimColor>{seg.text}</Text>
        ),
      )}
    </Box>
  );
}
