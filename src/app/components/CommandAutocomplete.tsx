/**
 * Command Autocomplete Component
 * Shows dropdown of matching slash commands with improved filtering and descriptions
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "../theme.ts";
import type { SlashCommand } from "../slashCommands.ts";

/**
 * Category icons for visual grouping
 */
const CATEGORY_ICONS: Record<string, string> = {
  market: "M",
  trading: "T",
  account: "A",
  system: "S",
};

/**
 * Category labels for separators
 */
const CATEGORY_LABELS: Record<string, string> = {
  market: "Market Discovery",
  trading: "Trading",
  account: "Account",
  system: "System",
};

/**
 * Category colors for visual distinction
 */
const CATEGORY_COLORS: Record<string, string> = {
  market: COLORS.BLUE,
  trading: COLORS.GREEN,
  account: COLORS.YELLOW,
  system: COLORS.DIM,
};

/**
 * Level colors for visual distinction
 */
const LEVEL_COLORS: Record<number, string> = {
  1: COLORS.GREEN,
  2: COLORS.YELLOW,
  3: COLORS.ORANGE,
};

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
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 100;
  const COMMAND_COL_WIDTH = 18;
  const ALIAS_COL_WIDTH = 10;
  const DESCRIPTION_COL_MAX = 60;
  const DESCRIPTION_COL_MIN = 20;
  const STATIC_COL_WIDTH = COMMAND_COL_WIDTH + ALIAS_COL_WIDTH + 5 + 5; // selection + icon + spaces + level buffer
  const availableDescriptionWidth = terminalWidth - STATIC_COL_WIDTH;
  const DESCRIPTION_COL_WIDTH = Math.max(
    DESCRIPTION_COL_MIN,
    Math.min(DESCRIPTION_COL_MAX, availableDescriptionWidth)
  );

  const truncateText = (value: string, width: number): string => {
    if (value.length <= width) return value;
    if (width <= 3) return value.slice(0, width);
    return value.slice(0, width - 3) + "...";
  };

  const padSpaces = (value: string, width: number): string => {
    if (value.length >= width) return "";
    return " ".repeat(width - value.length);
  };

  // Extract the search term (after /)
  const searchTerm = inputValue.startsWith("/") ? inputValue.slice(1).toLowerCase().split(/\s+/)[0] || "" : "";

  // Use suggestions directly - DO NOT re-filter or re-sort!
  // The filtering already happens in getSlashCommandSuggestions() in ChatInput.
  // Re-sorting here causes a mismatch between displayed order and selectedIndex,
  // which leads to the wrong command being executed when user presses Enter.
  const filteredSuggestions = suggestions;

  if (filteredSuggestions.length === 0) {
    // Show "no matches" message if user is typing a command
    if (searchTerm.length > 0) {
      return (
        <Box
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

  // Track current category for grouping
  let lastCategory = "";

  return (
    <Box
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

      {/* Suggestions with category grouping */}
      {visibleSuggestions.map((cmd, index) => {
        const isSelected = index === adjustedSelectedIndex;
        const cmdName = `/${cmd.name}`;
        const displayName = truncateText(cmdName, COMMAND_COL_WIDTH);

        // Highlight matching portion
        const matchEnd = Math.min(searchTerm.length + 1, displayName.length);
        const matchedPart = displayName.slice(0, matchEnd);
        const restPart = displayName.slice(matchEnd);

        // Show category separator if category changed
        const showCategorySeparator = showCategories && cmd.category !== lastCategory && startIndex === 0;
        if (showCategories) {
          lastCategory = cmd.category;
        }

        const categoryIcon = CATEGORY_ICONS[cmd.category] || "●";
        const categoryColor = CATEGORY_COLORS[cmd.category] || COLORS.DIM;
        const aliasText = cmd.aliases.length > 0 ? `(${cmd.aliases[0]})` : "";
        const aliasDisplay = truncateText(aliasText, ALIAS_COL_WIDTH);
        const commandPadding = padSpaces(displayName, COMMAND_COL_WIDTH);
        const aliasPadding = padSpaces(aliasDisplay, ALIAS_COL_WIDTH);
        const descriptionDisplay = truncateText(cmd.description, DESCRIPTION_COL_WIDTH);

        return (
          <Box key={cmd.name} flexDirection="column" paddingY={0}>
            {/* Category separator with label */}
            {showCategorySeparator && index > 0 && (
              <Box marginTop={1}>
                <Text color={COLORS.DIM}>─── </Text>
                <Text color={categoryColor} bold>{CATEGORY_LABELS[cmd.category] || cmd.category}</Text>
                <Text color={COLORS.DIM}> ───</Text>
              </Box>
            )}

            {/* Command row */}
            <Box>
              {/* Selection indicator */}
              <Text color={isSelected ? COLORS.HIGHLIGHT : COLORS.DIM}>
                {isSelected ? ">" : " "}
              </Text>

              {/* Category icon */}
              <Text color={categoryColor}>
                {categoryIcon}{" "}
              </Text>

              {/* Command name with highlight */}
              <Text color={isSelected ? COLORS.HIGHLIGHT : COLORS.ACCENT} bold={isSelected}>
                {matchedPart}
              </Text>
              <Text color={isSelected ? COLORS.HIGHLIGHT : COLORS.WHITE} bold={isSelected}>
                {restPart}
              </Text>
              <Text color={COLORS.DIM}>{commandPadding}</Text>
              <Text color={COLORS.DIM}> </Text>

              {/* Aliases (if any) */}
              <Text color={COLORS.MUTED}>
                {aliasDisplay}
              </Text>
              <Text color={COLORS.DIM}>{aliasPadding}</Text>
              <Text color={COLORS.DIM}> </Text>

              {/* Description */}
              <Text color={isSelected ? COLORS.WHITE : COLORS.DIM}>
                {descriptionDisplay}
              </Text>

              {/* Level badge for advanced/expert commands */}
              {cmd.level > 1 && (
                <Text color={LEVEL_COLORS[cmd.level] || COLORS.DIM}>
                  {" "}[L{cmd.level}]
                </Text>
              )}
            </Box>

            {/* Show usage for selected command */}
            {showUsage && isSelected && (
              <Box marginLeft={3}>
                <Text color={COLORS.DIM} italic>
                  Usage: {cmd.usage}
                </Text>
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

  const categoryIcon = CATEGORY_ICONS[command.category] || "●";
  const categoryColor = CATEGORY_COLORS[command.category] || COLORS.DIM;

  return (
    <Box marginLeft={1} flexDirection="column">
      <Box>
        <Text color={categoryColor}>{categoryIcon} </Text>
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
