import React from "react";
import { Box, Text } from "ink";

// ============================================================================
// IssueFlagBanner — Trading-specific warning banner above the input
//
// Returns null when issue is null so it takes up zero space.
// Yellow text with a leading ⚠ glyph.
// ============================================================================

type IssueKey =
  | "exchange_disconnected"
  | "risk_limit"
  | "low_margin"
  | "api_error"
  | "rate_limit";

interface Props {
  issue: IssueKey | null;
}

const ISSUE_MESSAGES: Record<IssueKey, string> = {
  exchange_disconnected: "⚠ Exchange disconnected — reconnect with /exchange",
  risk_limit:            "⚠ Risk limit reached — review with /risk",
  low_margin:            "⚠ Low margin warning — check portfolio",
  api_error:             "⚠ API error — check /doctor",
  rate_limit:            "⚠ Rate limited — requests slowing down",
};

export function IssueFlagBanner({ issue }: Props) {
  if (issue === null) return null;

  const message = ISSUE_MESSAGES[issue];

  return (
    <Box paddingLeft={2}>
      <Text color="yellow">{message}</Text>
    </Box>
  );
}
