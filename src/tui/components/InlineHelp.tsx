import React from "react";
import { Box, Text } from "ink";

// ============================================================================
// InlineHelp — Quick reference shown on ? press, hidden on type
// ============================================================================

export function InlineHelp() {
  return (
    <Box flexDirection="column" marginTop={1} paddingX={2}>
      <Text dimColor>Quick Reference:</Text>
      <Text>  <Text bold>/scan</Text>          Scan top movers</Text>
      <Text>  <Text bold>/analyze BTC</Text>   Technical analysis</Text>
      <Text>  <Text bold>/plan BTC</Text>      Create trade plan</Text>
      <Text>  <Text bold>/positions</Text>     Open positions</Text>
      <Text>  <Text bold>/help</Text>          Full command list</Text>
      <Text>  <Text bold>/doctor</Text>        System health</Text>
      <Text> </Text>
      <Text dimColor>  Or just describe what you want:</Text>
      <Text color="cyanBright">  "find me safe momentum setups under 2% risk"</Text>
    </Box>
  );
}
