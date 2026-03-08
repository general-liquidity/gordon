/**
 * Quick Actions Component
 * Shows clickable/selectable buttons for frequent commands
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../theme.ts";
import {
  getQuickActionItems,
  type QuickActionContext,
  type WorkflowGroup,
} from "../commandUx.ts";

function getWorkflowColor(workflow?: WorkflowGroup): string {
  switch (workflow) {
    case "discover":
      return COLORS.DISCOVER;
    case "analyze":
      return COLORS.ANALYZE;
    case "trade":
      return COLORS.TRADE;
    case "run":
      return COLORS.RUN;
    case "accounts":
      return COLORS.RAILS;
    case "operate":
      return COLORS.OPERATE;
    default:
      return COLORS.HIGHLIGHT;
  }
}

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

  return (
    <Box marginBottom={1} marginX={1} paddingX={1}>
      <Text color={COLORS.DIM}>Next: </Text>
      {actions.map((action, i) => {
        const isSelected = i === selectedIndex;
        const workflowColor = getWorkflowColor(action.workflow);
        return (
          <Box key={action.command} marginRight={2}>
            <Text color={isSelected ? workflowColor : COLORS.DIM}>
              {isSelected ? ">" : " "}
            </Text>
            <Text color={COLORS.WHITE} bold={isSelected}>
              {action.label}
            </Text>
            <Text color={COLORS.DIM} dimColor>
              [{i + 1}]
            </Text>
            {isSelected && (
              <Text color={workflowColor}> ({action.command})</Text>
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
