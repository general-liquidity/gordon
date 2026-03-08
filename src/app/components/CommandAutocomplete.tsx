/**
 * Command Autocomplete Component
 * Shows dropdown of matching slash commands with improved filtering and descriptions
 */

import React from "react";
import { Box, Text } from "ink";
import { getAutocompleteTokens } from "../componentTheme.ts";
import { clampWidth, truncateWithEllipsis, useMeasuredWidth } from "../layout.ts";
import { COLORS } from "../theme.ts";
import type { SlashCommand } from "../slashCommands.ts";
import { WORKFLOW_CONFIG } from "../commandUx.ts";

interface CommandAutocompleteProps {
  suggestions: SlashCommand[];
  selectedIndex: number;
  inputValue: string;
  maxVisible?: number;
  /** Show category grouping */
  showCategories?: boolean;
  /** Show usage examples */
  showUsage?: boolean;
}

export const CommandAutocomplete: React.FC<CommandAutocompleteProps> = ({
  suggestions,
  selectedIndex,
  inputValue,
  maxVisible = 8,
  showCategories = true,
  showUsage = false,
}) => {
  const { ref, width: terminalWidth } = useMeasuredWidth(100);
  const COMMAND_COL_WIDTH = 20;
  const DESCRIPTION_COL_MAX = 68;
  const DESCRIPTION_COL_MIN = 24;
  const STATIC_COL_WIDTH = COMMAND_COL_WIDTH + 6;
  const availableDescriptionWidth = terminalWidth - STATIC_COL_WIDTH;
  const DESCRIPTION_COL_WIDTH = clampWidth(availableDescriptionWidth, DESCRIPTION_COL_MIN, DESCRIPTION_COL_MAX);

  const padSpaces = (value: string, width: number): string => {
    if (value.length >= width) return "";
    return " ".repeat(width - value.length);
  };

  // Extract the search term (after /)
  const searchTerm = inputValue.startsWith("/") ? inputValue.slice(1).toLowerCase().split(/\s+/)[0] || "" : "";

  const filteredSuggestions = suggestions;

  if (filteredSuggestions.length === 0) {
    // Show "no matches" message if user is typing a command
    if (searchTerm.length > 0) {
      return (
        <Box
          ref={ref}
          flexDirection="column"
          borderStyle="single"
          borderColor={COLORS.DIM}
          paddingX={1}
          marginX={1}
          marginBottom={1}
        >
          <Text color={COLORS.DIM}>
            No commands matching "/{searchTerm}"
          </Text>
          <Text color={COLORS.DIM}>
            Type /help to see all available commands
          </Text>
        </Box>
      );
    }
    return null;
  }

  // Determine visible range (scroll if needed)
  const totalSuggestions = filteredSuggestions.length;
  const visibleCount = Math.min(totalSuggestions, maxVisible);

  let startIndex = 0;
  if (selectedIndex >= visibleCount) {
    startIndex = selectedIndex - visibleCount + 1;
  }
  // Ensure startIndex doesn't go out of bounds
  startIndex = Math.min(startIndex, Math.max(0, totalSuggestions - visibleCount));

  const visibleSuggestions = filteredSuggestions.slice(startIndex, startIndex + visibleCount);
  const adjustedSelectedIndex = selectedIndex - startIndex;

  let lastWorkflow = "";

  return (
    <Box
      ref={ref}
      flexDirection="column"
      borderStyle="single"
      borderColor={COLORS.ACCENT_DIM}
      paddingX={1}
      marginX={1}
      marginBottom={1}
    >
      {/* Header with count */}
      <Box marginBottom={1} justifyContent="space-between">
        <Text color={COLORS.WHITE} bold>
          Commands
        </Text>
        <Text color={COLORS.DIM}>
          {selectedIndex + 1}/{totalSuggestions}
        </Text>
      </Box>

      {/* Scroll up indicator */}
      {startIndex > 0 && (
        <Box>
          <Text color={COLORS.DIM}>  ... {startIndex} more above</Text>
        </Box>
      )}

      {/* Suggestions with workflow grouping */}
      {visibleSuggestions.map((cmd, index) => {
        const isSelected = index === adjustedSelectedIndex;
        const cmdName = `/${cmd.name}`;
        const displayName = truncateWithEllipsis(cmdName, COMMAND_COL_WIDTH);

        // Highlight matching portion
        const matchEnd = Math.min(searchTerm.length + 1, displayName.length);
        const matchedPart = displayName.slice(0, matchEnd);
        const restPart = displayName.slice(matchEnd);

        const showCategorySeparator = showCategories && cmd.workflow !== lastWorkflow && startIndex === 0;
        if (showCategories) {
          lastWorkflow = cmd.workflow;
        }

        const commandPadding = padSpaces(displayName, COMMAND_COL_WIDTH);
        const descriptionDisplay = truncateWithEllipsis(cmd.description, DESCRIPTION_COL_WIDTH);
        const workflowConfig = WORKFLOW_CONFIG[cmd.workflow];
        const tokens = getAutocompleteTokens(cmd.workflow, isSelected);

        return (
          <Box key={cmd.name} flexDirection="column" paddingY={0}>
            {/* Workflow separator with label */}
            {showCategorySeparator && index > 0 && (
              <Box marginTop={1}>
                <Text color={COLORS.DIM}>─── </Text>
                <Text color={tokens.accent} bold>{workflowConfig.label}</Text>
                <Text color={COLORS.DIM}> ───</Text>
              </Box>
            )}

            {/* Command row */}
            <Box>
              <Text color={tokens.prompt}>
                {isSelected ? ">" : " "}
              </Text>

              <Text color={tokens.accent} bold={isSelected}>
                {matchedPart}
              </Text>
              <Text color={tokens.label} bold={isSelected}>
                {restPart}
              </Text>
              <Text color={COLORS.DIM}>{commandPadding}</Text>
              <Text color={COLORS.DIM}> </Text>

              <Text color={tokens.description}>
                {descriptionDisplay}
              </Text>
            </Box>

            {(showUsage || isSelected) && (
              <Box marginLeft={2} flexDirection="column">
                <Text color={COLORS.DIM} italic>
                {workflowConfig.label}: {cmd.usage}
              </Text>
              {cmd.whenToUse && (
                <Text color={COLORS.DIM}>
                    When to use: {truncateWithEllipsis(cmd.whenToUse, terminalWidth - 8)}
                </Text>
              )}
            </Box>
            )}
          </Box>
        );
      })}

      {/* Scroll down indicator */}
      {startIndex + visibleCount < totalSuggestions && (
        <Box>
          <Text color={COLORS.DIM}>  ... {totalSuggestions - startIndex - visibleCount} more below</Text>
        </Box>
      )}

      {/* Help hint */}
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color={COLORS.DIM}>
            <Text color={COLORS.HIGHLIGHT}>Tab</Text> complete |{" "}
            <Text color={COLORS.HIGHLIGHT}>Enter</Text> run |{" "}
            <Text color={COLORS.HIGHLIGHT}>Up/Down</Text> navigate |{" "}
            <Text color={COLORS.HIGHLIGHT}>Esc</Text> cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

/**
 * Inline hint shown next to input when a command matches
 */
interface CommandHintProps {
  command: SlashCommand | null;
  showUsage?: boolean;
}

export const CommandHint: React.FC<CommandHintProps> = ({ command, showUsage = false }) => {
  if (!command) {
    return null;
  }

  const workflowConfig = WORKFLOW_CONFIG[command.workflow];
  const workflowColor = getAutocompleteTokens(command.workflow, true).accent;

  return (
    <Box marginLeft={1} flexDirection="column">
      <Box>
        <Text color={workflowColor}>{workflowConfig.icon} </Text>
        <Text color={COLORS.DIM} italic>
          {command.description}
        </Text>
      </Box>
      {showUsage && (
        <Box marginLeft={2}>
          <Text color={COLORS.MUTED}>
            Usage: {command.usage}
          </Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Fuzzy match helper - checks if all characters in search appear in target in order
 */
export function fuzzyMatch(search: string, target: string): boolean {
  const searchLower = search.toLowerCase();
  const targetLower = target.toLowerCase();

  let searchIndex = 0;
  for (let i = 0; i < targetLower.length && searchIndex < searchLower.length; i++) {
    if (targetLower[i] === searchLower[searchIndex]) {
      searchIndex++;
    }
  }

  return searchIndex === searchLower.length;
}

export default CommandAutocomplete;
