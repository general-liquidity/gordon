import React from "react";
import { Box, Text } from "ink";

// ============================================================================
// HandoffArrow — Transition indicator between agent chains
//
// → Handing off to Analyst
// ============================================================================

interface Props {
  from: string;
  to: string;
}

export function HandoffArrow({ from, to }: Props) {
  return (
    <Box marginY={0} paddingLeft={2}>
      <Text color="cyanBright">{"\u2192"}</Text>
      <Text dimColor> Handing off to </Text>
      <Text color="cyanBright">{to}</Text>
    </Box>
  );
}
