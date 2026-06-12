import React from "react";
import { Text } from "../../ink-custom";
import type { KillSwitchStatus } from "../../state/killSwitchStatus.ts";
import { useTheme } from "../../themes/ThemeProvider.tsx";

export function KillSwitchBadge({ status }: { status: KillSwitchStatus | null }): React.JSX.Element | null {
  const theme = useTheme();
  if (!status) return null;
  if (!status.enabled) return <Text color={theme.riskWarning} bold>[KILL SWITCHES OFF]</Text>;
  if (status.halted) return <Text color={theme.riskDanger} bold>[HALTED]</Text>;
  return <Text color={theme.riskSafe}>[ARMED]</Text>;
}
