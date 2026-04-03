import React from "react";
import { Box, Text, useInput } from "ink";

// ============================================================================
// Tabs — Horizontal tab bar with keyboard navigation
//
// ←→ keys cycle through tabs.  Active tab is bold + cyanBright.
// Children are rendered below the tab bar.
// ============================================================================

interface Tab {
  key: string;
  label: string;
}

interface Props {
  tabs: Tab[];
  activeKey: string;
  onChange: (key: string) => void;
  children: React.ReactNode;
}

export function Tabs({ tabs, activeKey, onChange, children }: Props) {
  useInput((_input, key) => {
    const currentIndex = tabs.findIndex((t) => t.key === activeKey);
    if (currentIndex < 0) return;

    if (key.leftArrow) {
      const prev = (currentIndex - 1 + tabs.length) % tabs.length;
      onChange(tabs[prev].key);
    } else if (key.rightArrow) {
      const next = (currentIndex + 1) % tabs.length;
      onChange(tabs[next].key);
    }
  });

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        {tabs.map((tab, i) => {
          const isActive = tab.key === activeKey;
          return (
            <React.Fragment key={tab.key}>
              {i > 0 ? <Text dimColor>{"\u2502"}</Text> : null}
              <Text bold={isActive} color={isActive ? "cyanBright" : undefined} dimColor={!isActive}>
                {tab.label}
              </Text>
            </React.Fragment>
          );
        })}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
    </Box>
  );
}
