/**
 * Command Autocomplete Component
 * Shows dropdown of matching slash commands
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../theme.ts";
import type { SlashCommand } from "../slashCommands.ts";

interface CommandAutocompleteProps {
  suggestions: SlashCommand[];
  selectedIndex: number;
  inputValue: string;
  maxVisible?: number;
}

export const CommandAutocomplete: React.FC<CommandAutocompleteProps> = ({
  suggestions,
  selectedIndex,
  inputValue,
  maxVisible = 6,
}) => {
  if (suggestions.length === 0) {
    return null;
  }

  // Determine visible range (scroll if needed)
  const totalSuggestions = suggestions.length;
  const visibleCount = Math.min(totalSuggestions, maxVisible);

  let startIndex = 0;
  if (selectedIndex >= visibleCount) {
    startIndex = selectedIndex - visibleCount + 1;
  }

  const visibleSuggestions = suggestions.slice(startIndex, startIndex + visibleCount);
  const adjustedSelectedIndex = selectedIndex - startIndex;

  // Extract the search term (after /)
  const searchTerm = inputValue.slice(1).toLowerCase();

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={COLORS.ACCENT_DIM}
      paddingX={1}
      marginX={1}
      marginBottom={1}
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={COLORS.DIM}>
          Commands {totalSuggestions > visibleCount && `(${selectedIndex + 1}/${totalSuggestions})`}
        </Text>
      </Box>

      {/* Scroll up indicator */}
      {startIndex > 0 && (
        <Box>
          <Text color={COLORS.DIM}>  ...</Text>
        </Box>
      )}

      {/* Suggestions */}
      {visibleSuggestions.map((cmd, index) => {
        const isSelected = index === adjustedSelectedIndex;
        const cmdName = `/${cmd.name}`;

        // Highlight matching portion
        const matchEnd = searchTerm.length + 1; // +1 for the /
        const matchedPart = cmdName.slice(0, matchEnd);
        const restPart = cmdName.slice(matchEnd);

        return (
          <Box key={cmd.name} paddingY={0}>
            {/* Selection indicator */}
            <Text color={isSelected ? COLORS.HIGHLIGHT : COLORS.DIM}>
              {isSelected ? ">" : " "}
            </Text>

            {/* Command name with highlight */}
            <Box width={14}>
              <Text color={isSelected ? COLORS.HIGHLIGHT : COLORS.ACCENT} bold={isSelected}>
                {matchedPart}
              </Text>
              <Text color={isSelected ? COLORS.HIGHLIGHT : COLORS.WHITE} bold={isSelected}>
                {restPart}
              </Text>
            </Box>

            {/* Description */}
            <Text color={COLORS.DIM}>
              {cmd.description.length > 40
                ? cmd.description.slice(0, 37) + "..."
                : cmd.description}
            </Text>
          </Box>
        );
      })}

      {/* Scroll down indicator */}
      {startIndex + visibleCount < totalSuggestions && (
        <Box>
          <Text color={COLORS.DIM}>  ...</Text>
        </Box>
      )}

      {/* Help hint */}
      <Box marginTop={1}>
        <Text color={COLORS.DIM}>
          Tab to complete | Enter to run | Esc to cancel
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Inline hint shown next to input when a command matches
 */
interface CommandHintProps {
  command: SlashCommand | null;
}

export const CommandHint: React.FC<CommandHintProps> = ({ command }) => {
  if (!command) {
    return null;
  }

  return (
    <Box marginLeft={1}>
      <Text color={COLORS.DIM} italic>
        {command.description}
      </Text>
    </Box>
  );
};

export default CommandAutocomplete;
