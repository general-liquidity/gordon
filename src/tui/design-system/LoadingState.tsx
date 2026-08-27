import { Box, Text } from "../ink-custom";
import { Spinner } from "@inkjs/ui";

// ============================================================================
// LoadingState — Spinner + message + optional subtitle
// ============================================================================

interface Props {
  message: string;
  subtitle?: string;
}

export function LoadingState({ message, subtitle }: Props) {
  return (
    <Box flexDirection="column" gap={0}>
      <Box gap={1}>
        <Spinner />
        <Text>{message}</Text>
      </Box>
      {subtitle ? (
        <Box paddingLeft={2}>
          <Text dimColor>{subtitle}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
