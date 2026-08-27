import { Box, Text } from "../ink-custom";

// ============================================================================
// ContextSuggestions — Proactive suggestions to optimize context budget
// ============================================================================

export interface Suggestion {
  title: string;
  savings: number;
  action: string;
}

interface Props {
  suggestions: Suggestion[];
}

export function ContextSuggestions({ suggestions }: Props) {
  if (suggestions.length === 0) return null;
  return (
    <Box flexDirection="column">
      <Text dimColor bold>
        Suggestions:
      </Text>
      {suggestions.map((s, i) => (
        <Box key={i}>
          <Text color="cyan">{"\u2139"} </Text>
          <Text>{s.title}</Text>
          <Text dimColor> (save ~{(s.savings / 1000).toFixed(1)}k tokens) </Text>
          <Text dimColor italic>
            {s.action}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
