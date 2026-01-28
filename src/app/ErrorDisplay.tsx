import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

// Color palette
const COLORS = {
  TAN: "#d4a27f",
  TAN_DIM: "#b8896a",
  WHITE: "#e8e4de",
  DIM: "#a39e93",
  ERROR: "#e57373",
} as const;

interface ErrorDisplayProps {
  title?: string;
  message: string;
  details?: string;
  showRetry?: boolean;
  showMenu?: boolean;
  onRetry?: () => void;
  onMenu?: () => void;
}

export function ErrorDisplay({
  title = "Something went wrong",
  message,
  details,
  showRetry = true,
  showMenu = true,
  onRetry,
  onMenu,
}: ErrorDisplayProps): React.ReactElement {
  const [selectedOption, setSelectedOption] = useState<"retry" | "menu">(
    "retry"
  );

  const hasRetry = showRetry && onRetry;
  const hasMenu = showMenu && onMenu;
  const hasOptions = hasRetry || hasMenu;

  useInput((input, key) => {
    if (!hasOptions) return;

    // Handle arrow key navigation between options
    if (key.leftArrow || key.rightArrow) {
      if (hasRetry && hasMenu) {
        setSelectedOption((prev) => (prev === "retry" ? "menu" : "retry"));
      }
    }

    // Handle selection
    if (key.return) {
      if (selectedOption === "retry" && hasRetry) {
        onRetry();
      } else if (selectedOption === "menu" && hasMenu) {
        onMenu();
      }
    }

    // Keyboard shortcuts
    if (input === "r" && hasRetry) {
      onRetry();
    }
    if (input === "m" && hasMenu) {
      onMenu();
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Error icon and title */}
      <Box marginBottom={1}>
        <Text color={COLORS.ERROR} bold>
          [!] {title}
        </Text>
      </Box>

      {/* Error message */}
      <Box
        borderStyle="single"
        borderColor={COLORS.ERROR}
        paddingX={2}
        paddingY={1}
        flexDirection="column"
      >
        <Text color={COLORS.WHITE}>{message}</Text>

        {/* Optional details (collapsed by default in production) */}
        {details && (
          <Box marginTop={1} flexDirection="column">
            <Text color={COLORS.DIM}>Details:</Text>
            <Text color={COLORS.DIM}>{details}</Text>
          </Box>
        )}
      </Box>

      {/* Action buttons */}
      {hasOptions && (
        <Box marginTop={1} gap={2}>
          {hasRetry && (
            <Box>
              <Text
                color={selectedOption === "retry" ? COLORS.TAN : COLORS.DIM}
                bold={selectedOption === "retry"}
              >
                {selectedOption === "retry" ? ">" : " "}
              </Text>
              <Text
                color={selectedOption === "retry" ? COLORS.TAN : COLORS.DIM}
              >
                {" "}
                [R] Retry
              </Text>
            </Box>
          )}

          {hasMenu && (
            <Box>
              <Text
                color={selectedOption === "menu" ? COLORS.TAN : COLORS.DIM}
                bold={selectedOption === "menu"}
              >
                {selectedOption === "menu" ? ">" : " "}
              </Text>
              <Text
                color={selectedOption === "menu" ? COLORS.TAN : COLORS.DIM}
              >
                {" "}
                [M] Return to Menu
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* Help text */}
      {hasOptions && (
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>
            Use arrow keys or press [R]/[M] to select an option
          </Text>
        </Box>
      )}
    </Box>
  );
}

export default ErrorDisplay;
