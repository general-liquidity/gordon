/**
 * Quick Actions Component
 * Shows clickable/selectable buttons for frequent commands
 */

import React from "react";
import { Box, Text } from "ink";
import { getQuickActionTokens } from "../componentTheme.ts";
import { truncateWithEllipsis, useMeasuredWidth } from "../layout.ts";
import { COLORS } from "../theme.ts";
import {
  getQuickActionItems,
  type QuickActionContext,
} from "../commandUx.ts";

interface QuickActionsProps {
  onSelect: (command: string) => void;
  selectedIndex: number;
  visible: boolean;
  context: QuickActionContext;
}

export function QuickActions({
  onSelect,
  selectedIndex,
  visible,
  context,
}: QuickActionsProps): React.ReactElement | null {
  if (!visible) {
    return null;
  }

  const actions = getQuickActionItems(context);
  const { ref, width } = useMeasuredWidth(88);
  const perActionWidth = Math.max(8, Math.floor((width - 8) / Math.max(actions.length, 1)));
  const showCommandHint = width >= 96;

  return (
    <Box ref={ref} marginBottom={1} marginX={1} paddingX={1}>
      <Text color={COLORS.DIM}>Next: </Text>
      {actions.map((action, i) => {
        const isSelected = i === selectedIndex;
        const tokens = getQuickActionTokens(action.workflow, isSelected);
        const label = truncateWithEllipsis(action.label, Math.max(4, perActionWidth - 4));
        return (
          <Box key={action.command} marginRight={2}>
            <Text color={tokens.cue}>
              {isSelected ? ">" : " "}
            </Text>
            <Text color={tokens.label} bold={isSelected}>
              {label}
            </Text>
            <Text color={COLORS.DIM} dimColor>
              [{i + 1}]
            </Text>
            {isSelected && showCommandHint && (
              <Text color={tokens.command}> ({action.command})</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export function getQuickActionCommand(index: number, context: QuickActionContext): string | null {
  const action = getQuickActionItems(context)[index];
  return action ? action.command : null;
}

export function getQuickActionsCount(context: QuickActionContext): number {
  return getQuickActionItems(context).length;
}

export { getQuickActionItems };
