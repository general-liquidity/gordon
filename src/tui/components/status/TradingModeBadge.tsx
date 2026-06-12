import React from "react";
import { Text } from "../../ink-custom";
import type { PermissionMode } from "../../state/types.ts";
import { useTheme } from "../../themes/ThemeProvider.tsx";
import type { GordonTheme } from "../../themes/themes.ts";

const MODE_STYLE: Record<PermissionMode, { label: string; token: keyof GordonTheme; bold?: boolean }> = {
  auto: { label: "LIVE AUTO", token: "riskDanger", bold: true },
  ask: { label: "LIVE ASK", token: "riskDanger", bold: true },
  strict: { label: "STRICT", token: "riskWarning" },
  paper: { label: "PAPER", token: "riskWarning", bold: true },
  observe: { label: "OBSERVE", token: "uiMuted" },
  plan: { label: "PLAN", token: "uiInfo" },
};

export function TradingModeBadge({ mode }: { mode: PermissionMode }): React.JSX.Element {
  const theme = useTheme();
  const style = MODE_STYLE[mode];
  return <Text color={theme[style.token]} bold={style.bold}>[{style.label}]</Text>;
}
