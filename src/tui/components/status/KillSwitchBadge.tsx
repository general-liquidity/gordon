import type React from "react";
import { Text } from "../../ink-custom";
import { formatKillSwitchBadge } from "../../state/killSwitchStatus.ts";
import type { KillSwitchStatus } from "../../state/killSwitchStatus.ts";
import { useTheme } from "../../themes/ThemeProvider.tsx";

export function KillSwitchBadge({
  status,
}: {
  status: KillSwitchStatus | null;
}): React.JSX.Element | null {
  const theme = useTheme();
  if (!status) return null;
  const badge = formatKillSwitchBadge(status);
  if (badge.severity === "off")
    return (
      <Text color={theme.riskWarning} bold>
        {badge.text}
      </Text>
    );
  if (badge.severity === "halted")
    return (
      <Text color={theme.riskDanger} bold>
        {badge.text}
      </Text>
    );
  return <Text color={theme.uiMuted}>{badge.text}</Text>;
}
