import React, { useMemo, type ReactNode } from "react";
import {
  ThemeProvider as InkUIThemeProvider,
  extendTheme,
  defaultTheme,
  type Theme,
} from "@inkjs/ui";
import { useTheme } from "./ThemeProvider.tsx";
import type { GordonTheme } from "./themes.ts";

// ============================================================================
// Ink-UI theme bridge — maps @inkjs/ui's hardcoded-blue/green defaults onto
// Gordon's semantic tokens so every @inkjs/ui Select / MultiSelect / Alert /
// ProgressBar renders in the active Gordon theme. This is the single source
// of truth that lets us drop the hand-rolled Select forks: Gordon's token
// layer stays authoritative; @inkjs/ui is just the render layer under it.
//
// Money Rule note: @inkjs/ui defaults selection to green (money-reserved).
// We remap selection to uiSelection and focus to uiBrand so green/red are
// never spent on generic list-selection chrome.
// ============================================================================

function alertColor(theme: GordonTheme, variant: string): string {
  switch (variant) {
    case "success":
      return theme.riskSafe;
    case "error":
      return theme.riskDanger;
    case "warning":
      return theme.riskWarning;
    default:
      return theme.uiInfo;
  }
}

export function buildInkUiTheme(theme: GordonTheme): Theme {
  return extendTheme(defaultTheme, {
    components: {
      Select: {
        styles: {
          focusIndicator: () => ({ color: theme.uiBrand }),
          selectedIndicator: () => ({ color: theme.uiSelection }),
          label: ({ isFocused, isSelected }: { isFocused: boolean; isSelected: boolean }) => {
            let color: string | undefined;
            if (isSelected) color = theme.uiSelection;
            if (isFocused) color = theme.uiBrand;
            return { color };
          },
        },
      },
      MultiSelect: {
        styles: {
          focusIndicator: () => ({ color: theme.uiBrand }),
          selectedIndicator: () => ({ color: theme.uiSelection }),
          label: ({ isFocused, isSelected }: { isFocused: boolean; isSelected: boolean }) => {
            let color: string | undefined;
            if (isSelected) color = theme.uiSelection;
            if (isFocused) color = theme.uiBrand;
            return { color };
          },
        },
      },
      ProgressBar: {
        styles: {
          completed: () => ({ color: theme.progressFill }),
        },
      },
      Alert: {
        // deepmerge overwrites same-key style functions wholesale, so the
        // container override must reproduce the default box props it replaces.
        styles: {
          container: ({ variant }: { variant: string }) => ({
            flexGrow: 1,
            borderStyle: "round",
            borderColor: alertColor(theme, variant),
            gap: 1,
            paddingX: 1,
          }),
          icon: ({ variant }: { variant: string }) => ({ color: alertColor(theme, variant) }),
        },
      },
    },
  } as Theme);
}

export function GordonInkUITheme({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const inkTheme = useMemo(() => buildInkUiTheme(theme), [theme]);
  return <InkUIThemeProvider theme={inkTheme}>{children}</InkUIThemeProvider>;
}
