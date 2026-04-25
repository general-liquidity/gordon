import React from "react";
import { Box, Text } from "../ink-custom";

interface Props {
  query: string;
  matchCount: number;
  currentMatchIndex: number;
  isActive: boolean;
}

export function SearchBar({ query, matchCount, currentMatchIndex, isActive }: Props) {
  if (!isActive) return null;
  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">{"?"}</Text>
      <Text>{query}</Text>
      <Text dimColor>
        {"  "}
        {matchCount > 0
          ? `${currentMatchIndex + 1}/${matchCount} matches — n/N to navigate`
          : "no matches"}
      </Text>
    </Box>
  );
}
