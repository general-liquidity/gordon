import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";

import { COLORS } from "./theme.ts";
import {
  createErrorContext,
  detectErrorType,
  type ErrorContext,
  type RecoveryStep,
} from "../utils/errorContext.ts";

/**
 * Error suggestion with actionable hint
 */
interface ErrorSuggestion {
  /** Short label for the suggestion */
  label: string;
  /** Detailed suggestion text */
  description: string;
  /** Command to run (if applicable) */
  command?: string;
  /** Documentation link (if applicable) */
  docUrl?: string;
}

/**
 * Known error patterns and their suggestions
 */
const ERROR_SUGGESTIONS: Record<string, ErrorSuggestion[]> = {
  // API Key errors
  "api key": [
    {
      label: "Check API Keys",
      description: "Verify your API keys are correctly set in the .env file",
      command: "/setup",
    },
    {
      label: "Regenerate Keys",
      description: "Try generating new API keys from Binance",
      docUrl: "https://www.binance.com/en/support/faq/how-to-create-api-keys-on-binance-360002502072",
    },
  ],
  "unauthorized": [
    {
      label: "Check Permissions",
      description: "Ensure your API key has the required permissions (Enable Reading, Enable Spot Trading)",
      command: "/status",
    },
  ],
  "invalid signature": [
    {
      label: "Check API Secret",
      description: "Your API secret may be incorrect or have extra whitespace",
      command: "/setup",
    },
    {
      label: "Sync Time",
      description: "Ensure your system clock is synchronized (NTP)",
    },
  ],

  // Rate limit errors
  "rate limit": [
    {
      label: "Wait and Retry",
      description: "Binance has rate limits. Wait a minute before trying again.",
    },
    {
      label: "Reduce Requests",
      description: "Try using /scan with fewer coins or longer intervals",
    },
  ],
  "too many requests": [
    {
      label: "Wait 1 Minute",
      description: "You've hit the request limit. Wait before retrying.",
    },
  ],

  // Balance errors
  "insufficient balance": [
    {
      label: "Check Balance",
      description: "Verify you have enough funds for this trade",
      command: "/portfolio",
    },
    {
      label: "Reduce Size",
      description: "Try a smaller position size",
    },
  ],
  "not enough": [
    {
      label: "View Portfolio",
      description: "Check your available balance",
      command: "/portfolio",
    },
  ],

  // Symbol errors
  "invalid symbol": [
    {
      label: "Check Symbol",
      description: "Make sure you're using a valid trading pair (e.g., BTCUSDT)",
      command: "/trending",
    },
  ],
  "symbol not found": [
    {
      label: "List Symbols",
      description: "Use /trending to see available trading pairs",
      command: "/trending",
    },
  ],

  // Connection errors
  "connection": [
    {
      label: "Check Internet",
      description: "Verify your internet connection is working",
    },
    {
      label: "Test Connection",
      description: "Run a connection test",
      command: "/status",
    },
  ],
  "network": [
    {
      label: "Check Connection",
      description: "Your network may be unstable. Try again.",
    },
  ],
  "timeout": [
    {
      label: "Retry",
      description: "The request timed out. Try again.",
    },
    {
      label: "Check Status",
      description: "Binance may be experiencing issues",
      docUrl: "https://www.binance.com/en/support",
    },
  ],

  // LLM errors
  "openai": [
    {
      label: "Check LLM Key",
      description: "Verify your OpenAI API key is valid",
      command: "/setup",
    },
    {
      label: "Change Model",
      description: "Try switching to a different AI model",
      command: "/model",
    },
  ],
  "model": [
    {
      label: "Select Model",
      description: "Try selecting a different AI model",
      command: "/model",
    },
  ],

  // Trading mode errors
  "safe mode": [
    {
      label: "Arm System",
      description: "Enable ARMED mode to execute trades",
      command: "/arm",
    },
  ],
  "armed": [
    {
      label: "Disarm System",
      description: "Return to SAFE mode",
      command: "/disarm",
    },
  ],

  // Generic fallback
  "default": [
    {
      label: "Get Help",
      description: "Ask Gordon for help with this issue",
      command: "/help",
    },
    {
      label: "Check Status",
      description: "Run a system diagnostic",
      command: "/status",
    },
  ],
};

/**
 * Find suggestions based on error message
 */
function findSuggestions(message: string, code?: string): ErrorSuggestion[] {
  const lowerMessage = message.toLowerCase();
  const lowerCode = code?.toLowerCase() || "";

  // Check each pattern
  for (const [pattern, suggestions] of Object.entries(ERROR_SUGGESTIONS)) {
    if (pattern === "default") continue;
    if (lowerMessage.includes(pattern) || lowerCode.includes(pattern)) {
      return suggestions;
    }
  }

  // Return default suggestions
  return ERROR_SUGGESTIONS["default"] || [];
}

/**
 * Error category for visual styling
 */
type ErrorCategory = "connection" | "auth" | "validation" | "trading" | "system" | "unknown";

function categorizeError(message: string, code?: string): ErrorCategory {
  const lower = (message + " " + (code || "")).toLowerCase();

  if (lower.includes("connect") || lower.includes("network") || lower.includes("timeout")) {
    return "connection";
  }
  if (lower.includes("auth") || lower.includes("key") || lower.includes("signature") || lower.includes("unauthorized")) {
    return "auth";
  }
  if (lower.includes("invalid") || lower.includes("validation") || lower.includes("required")) {
    return "validation";
  }
  if (lower.includes("balance") || lower.includes("order") || lower.includes("trade") || lower.includes("position")) {
    return "trading";
  }
  if (lower.includes("config") || lower.includes("setup") || lower.includes("model")) {
    return "system";
  }
  return "unknown";
}

const CATEGORY_ICONS: Record<ErrorCategory, string> = {
  connection: "~",
  auth: "!",
  validation: "?",
  trading: "$",
  system: "*",
  unknown: "!",
};

const CATEGORY_COLORS: Record<ErrorCategory, string> = {
  connection: COLORS.YELLOW,
  auth: COLORS.RED,
  validation: COLORS.YELLOW,
  trading: COLORS.RED,
  system: COLORS.BLUE,
  unknown: COLORS.ERROR,
};

interface ErrorDisplayProps {
  title?: string;
  message: string;
  details?: string;
  /** Error code (e.g., from Binance API) */
  errorCode?: string;
  showRetry?: boolean;
  showMenu?: boolean;
  onRetry?: () => void;
  onMenu?: () => void;
  /** Custom suggestions (overrides auto-detected) */
  suggestions?: ErrorSuggestion[];
  /** Callback when a command suggestion is selected */
  onCommandSelect?: (command: string) => void;
  /** Show expanded details by default */
  expandedDetails?: boolean;
}

export function ErrorDisplay({
  title = "Something went wrong",
  message,
  details,
  errorCode,
  showRetry = true,
  showMenu = true,
  onRetry,
  onMenu,
  suggestions: customSuggestions,
  onCommandSelect,
  expandedDetails = false,
}: ErrorDisplayProps): React.ReactElement {
  const [selectedOption, setSelectedOption] = useState<"retry" | "menu" | number>(
    "retry"
  );
  const [showDetails, setShowDetails] = useState(expandedDetails);

  const hasRetry = showRetry && onRetry;
  const hasMenu = showMenu && onMenu;

  // Get suggestions
  const suggestions = useMemo(() => {
    return customSuggestions || findSuggestions(message, errorCode);
  }, [message, errorCode, customSuggestions]);

  const hasSuggestions = suggestions.length > 0;
  const hasCommandSuggestions = suggestions.some(s => s.command) && onCommandSelect;

  // Categorize error for styling
  const category = useMemo(() => categorizeError(message, errorCode), [message, errorCode]);
  const categoryIcon = CATEGORY_ICONS[category];
  const categoryColor = CATEGORY_COLORS[category];

  const hasOptions = hasRetry || hasMenu || hasCommandSuggestions;

  useInput((input, key) => {
    // Toggle details with 'd'
    if (input === "d" && details) {
      setShowDetails(prev => !prev);
      return;
    }

    if (!hasOptions) return;

    // Handle arrow key navigation between options
    if (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow) {
      const options: Array<"retry" | "menu" | number> = [];
      if (hasRetry) options.push("retry");
      if (hasMenu) options.push("menu");
      if (hasCommandSuggestions) {
        suggestions.forEach((s, i) => {
          if (s.command) options.push(i);
        });
      }

      const currentIndex = options.indexOf(selectedOption);
      if (key.leftArrow || key.upArrow) {
        const newIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
        setSelectedOption(options[newIndex]!);
      } else {
        const newIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
        setSelectedOption(options[newIndex]!);
      }
    }

    // Handle selection
    if (key.return) {
      if (selectedOption === "retry" && hasRetry) {
        onRetry();
      } else if (selectedOption === "menu" && hasMenu) {
        onMenu();
      } else if (typeof selectedOption === "number" && onCommandSelect) {
        const suggestion = suggestions[selectedOption];
        if (suggestion?.command) {
          onCommandSelect(suggestion.command);
        }
      }
    }

    // Keyboard shortcuts
    if (input === "r" && hasRetry) {
      onRetry();
    }
    if (input === "m" && hasMenu) {
      onMenu();
    }

    // Number keys for suggestion shortcuts (1-9)
    const numKey = parseInt(input, 10);
    if (numKey >= 1 && numKey <= 9 && onCommandSelect) {
      const suggestion = suggestions[numKey - 1];
      if (suggestion?.command) {
        onCommandSelect(suggestion.command);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Error icon and title */}
      <Box marginBottom={1}>
        <Text color={categoryColor} bold>
          [{categoryIcon}] {title}
        </Text>
        {errorCode && (
          <Text color={COLORS.DIM}> (Code: {errorCode})</Text>
        )}
      </Box>

      {/* Error message */}
      <Box
        borderStyle="single"
        borderColor={categoryColor}
        paddingX={2}
        paddingY={1}
        flexDirection="column"
      >
        <Text color={COLORS.WHITE}>{message}</Text>

        {/* Optional details (toggleable) */}
        {details && (
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text color={COLORS.DIM}>
                Details {showDetails ? "[-]" : "[+]"} (press 'd' to toggle)
              </Text>
            </Box>
            {showDetails && (
              <Box marginTop={1}>
                <Text color={COLORS.MUTED}>{details}</Text>
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* Suggestions section */}
      {hasSuggestions && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.ACCENT} bold>
            Try this:
          </Text>
          <Box flexDirection="column" marginLeft={2} marginTop={1}>
            {suggestions.map((suggestion, index) => {
              const isSelected = selectedOption === index;
              return (
                <Box key={`suggestion-${index}`} flexDirection="column" marginBottom={1}>
                  <Box>
                    {suggestion.command && onCommandSelect && (
                      <Text color={isSelected ? COLORS.HIGHLIGHT : COLORS.DIM}>
                        {isSelected ? ">" : " "} [{index + 1}]{" "}
                      </Text>
                    )}
                    <Text color={COLORS.WHITE} bold={isSelected}>
                      {suggestion.label}
                    </Text>
                    {suggestion.command && (
                      <Text color={COLORS.ACCENT}> ({suggestion.command})</Text>
                    )}
                  </Box>
                  <Box marginLeft={suggestion.command ? 5 : 2}>
                    <Text color={COLORS.DIM}>{suggestion.description}</Text>
                  </Box>
                  {suggestion.docUrl && (
                    <Box marginLeft={suggestion.command ? 5 : 2}>
                      <Text color={COLORS.BLUE} underline>
                        {suggestion.docUrl}
                      </Text>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Action buttons */}
      {(hasRetry || hasMenu) && (
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
            Use arrow keys to navigate |{" "}
            {hasRetry && "[R] Retry | "}
            {hasMenu && "[M] Menu | "}
            {hasCommandSuggestions && "[1-9] Quick action | "}
            {details && "[D] Toggle details"}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Simple inline error message with suggestion
 */
interface InlineErrorProps {
  message: string;
  suggestion?: string;
  command?: string;
  onCommandClick?: (command: string) => void;
}

export function InlineError({
  message,
  suggestion,
  command,
  onCommandClick,
}: InlineErrorProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color={COLORS.ERROR}>[!] </Text>
        <Text color={COLORS.WHITE}>{message}</Text>
      </Box>
      {suggestion && (
        <Box marginLeft={4}>
          <Text color={COLORS.DIM}>Tip: {suggestion}</Text>
          {command && onCommandClick && (
            <Text color={COLORS.ACCENT}> ({command})</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * Error boundary fallback component
 */
interface ErrorFallbackProps {
  error: Error;
  resetError?: () => void;
}

export function ErrorFallback({
  error,
  resetError,
}: ErrorFallbackProps): React.ReactElement {
  return (
    <ErrorDisplay
      title="Application Error"
      message={error.message}
      details={error.stack}
      showRetry={!!resetError}
      showMenu={false}
      onRetry={resetError}
      expandedDetails={false}
    />
  );
}

// ============================================================================
// Enhanced Error Display with Context
// ============================================================================

/**
 * Props for enhanced error display with structured context
 */
interface EnhancedErrorDisplayProps {
  /** The error that occurred */
  error: Error;
  /** What operation the user was trying to perform */
  operation: string;
  /** Additional context about the operation */
  context?: Record<string, unknown>;
  /** Show retry button */
  showRetry?: boolean;
  /** Show menu button */
  showMenu?: boolean;
  /** Retry callback */
  onRetry?: () => void;
  /** Menu callback */
  onMenu?: () => void;
  /** Command selection callback */
  onCommandSelect?: (command: string) => void;
}

/**
 * Enhanced error display that uses structured error context
 *
 * This component provides a more detailed error display with:
 * - Structured "What happened" section
 * - Clear "Why" explanation
 * - Numbered recovery steps with commands
 *
 * @example
 * ```tsx
 * <EnhancedErrorDisplay
 *   error={rateLimitError}
 *   operation="/analyze BTC"
 *   context={{ symbol: "BTCUSDT", timeframe: "15m" }}
 *   onCommandSelect={(cmd) => executeCommand(cmd)}
 * />
 * ```
 */
export function EnhancedErrorDisplay({
  error,
  operation,
  context,
  showRetry = true,
  showMenu = true,
  onRetry,
  onMenu,
  onCommandSelect,
}: EnhancedErrorDisplayProps): React.ReactElement {
  const [selectedStep, setSelectedStep] = useState(0);
  const [showDetails, setShowDetails] = useState(false);

  // Create error context
  const errorCtx = useMemo(
    () => createErrorContext(error, operation, context),
    [error, operation, context]
  );

  // Determine category color based on error type
  const errorType = detectErrorType(error);
  const categoryColor = useMemo(() => {
    switch (errorType) {
      case "RATE_LIMIT":
      case "TIMEOUT":
        return COLORS.YELLOW;
      case "AUTH_FAILURE":
      case "INSUFFICIENT_BALANCE":
      case "RISK_LIMIT":
        return COLORS.RED;
      case "NETWORK_ERROR":
        return COLORS.YELLOW;
      case "INVALID_SYMBOL":
        return COLORS.YELLOW;
      case "TRADING_MODE":
        return COLORS.BLUE;
      default:
        return COLORS.ERROR;
    }
  }, [errorType]);

  const hasRetry = showRetry && onRetry;
  const hasMenu = showMenu && onMenu;
  const commandSteps = errorCtx.recoverySteps.filter((s) => s.command);
  const hasCommandSteps = commandSteps.length > 0 && onCommandSelect;

  useInput((input, key) => {
    // Toggle details with 'd'
    if (input === "d") {
      setShowDetails((prev) => !prev);
      return;
    }

    // Navigate recovery steps
    if (key.upArrow || key.downArrow) {
      const maxSteps = errorCtx.recoverySteps.length;
      if (key.upArrow) {
        setSelectedStep((prev) => (prev > 0 ? prev - 1 : maxSteps - 1));
      } else {
        setSelectedStep((prev) => (prev < maxSteps - 1 ? prev + 1 : 0));
      }
    }

    // Execute selected step's command
    if (key.return && onCommandSelect) {
      const step = errorCtx.recoverySteps[selectedStep];
      if (step?.command) {
        onCommandSelect(step.command);
      }
    }

    // Keyboard shortcuts
    if (input === "r" && hasRetry) {
      onRetry();
    }
    if (input === "m" && hasMenu) {
      onMenu();
    }

    // Number keys for quick step selection (1-9)
    const numKey = parseInt(input, 10);
    if (numKey >= 1 && numKey <= 9 && numKey <= errorCtx.recoverySteps.length) {
      const step = errorCtx.recoverySteps[numKey - 1];
      if (step?.command && onCommandSelect) {
        onCommandSelect(step.command);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Error Header */}
      <Box marginBottom={1}>
        <Text color={categoryColor} bold>
          [!] {errorCtx.reason}
        </Text>
        {errorCtx.errorCode && (
          <Text color={COLORS.DIM}> (Code: {errorCtx.errorCode})</Text>
        )}
      </Box>

      {/* Main Error Box */}
      <Box
        borderStyle="single"
        borderColor={categoryColor}
        paddingX={2}
        paddingY={1}
        flexDirection="column"
      >
        {/* What Happened Section */}
        <Box flexDirection="column">
          <Text color={COLORS.ACCENT} bold>
            What happened:
          </Text>
          <Box marginLeft={2} flexDirection="column">
            <Box>
              <Text color={COLORS.DIM}>Attempted: </Text>
              <Text color={COLORS.WHITE}>{errorCtx.attempted}</Text>
            </Box>
            <Box>
              <Text color={COLORS.DIM}>During: </Text>
              <Text color={COLORS.WHITE}>{errorCtx.operation}</Text>
            </Box>
          </Box>
        </Box>

        {/* Why Section */}
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.ACCENT} bold>
            Why:
          </Text>
          <Box marginLeft={2}>
            <Text color={COLORS.WHITE}>{errorCtx.reason}</Text>
          </Box>
        </Box>

        {/* Technical Details (toggleable) */}
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={COLORS.DIM}>
              Details {showDetails ? "[-]" : "[+]"} (press 'd' to toggle)
            </Text>
          </Box>
          {showDetails && (
            <Box marginTop={1} marginLeft={2} flexDirection="column">
              <Text color={COLORS.MUTED}>{error.message}</Text>
              {error.stack && (
                <Box marginTop={1}>
                  <Text color={COLORS.MUTED} dimColor>
                    {error.stack.split("\n").slice(0, 5).join("\n")}
                  </Text>
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Box>

      {/* Recovery Section */}
      {errorCtx.recoverySteps.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.SUCCESS} bold>
            Recovery:
          </Text>
          <Box flexDirection="column" marginLeft={2} marginTop={1}>
            {errorCtx.recoverySteps.map((step, index) => {
              const isSelected = selectedStep === index;
              const hasCommand = !!step.command;

              return (
                <Box key={`step-${index}`} flexDirection="column" marginBottom={1}>
                  <Box>
                    {hasCommand && onCommandSelect ? (
                      <Text color={isSelected ? COLORS.HIGHLIGHT : COLORS.DIM}>
                        {isSelected ? ">" : " "} {step.step}.{" "}
                      </Text>
                    ) : (
                      <Text color={COLORS.DIM}>  {step.step}. </Text>
                    )}
                    <Text color={COLORS.WHITE} bold={isSelected}>
                      {step.description}
                    </Text>
                    {step.command && (
                      <Text color={COLORS.ACCENT}> {step.command}</Text>
                    )}
                    {step.waitSeconds && (
                      <Text color={COLORS.YELLOW}> (wait {step.waitSeconds}s)</Text>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Action Buttons */}
      {(hasRetry || hasMenu) && (
        <Box marginTop={1} gap={2}>
          {hasRetry && (
            <Box>
              <Text color={COLORS.TAN}>[R] Retry</Text>
            </Box>
          )}
          {hasMenu && (
            <Box>
              <Text color={COLORS.TAN}>[M] Return to Menu</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Help Text */}
      <Box marginTop={1}>
        <Text color={COLORS.DIM}>
          {hasCommandSteps && "Use arrows to select | [Enter] Execute | "}
          {hasCommandSteps && "[1-9] Quick select | "}
          {hasRetry && "[R] Retry | "}
          {hasMenu && "[M] Menu | "}
          [D] Toggle details
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Convert ErrorContext to suggestions format for legacy ErrorDisplay
 * This bridges the new context system with the existing suggestion-based display
 */
export function contextToSuggestions(ctx: ErrorContext): ErrorSuggestion[] {
  return ctx.recoverySteps.map((step) => ({
    label: `Step ${step.step}`,
    description: step.description + (step.waitSeconds ? ` (wait ${step.waitSeconds}s)` : ""),
    command: step.command,
  }));
}

/**
 * Create an error display from just an Error object
 * Automatically creates context and renders the enhanced display
 */
export function ErrorDisplayFromError({
  error,
  operation = "operation",
  onRetry,
  onMenu,
  onCommandSelect,
}: {
  error: Error;
  operation?: string;
  onRetry?: () => void;
  onMenu?: () => void;
  onCommandSelect?: (command: string) => void;
}): React.ReactElement {
  return (
    <EnhancedErrorDisplay
      error={error}
      operation={operation}
      showRetry={!!onRetry}
      showMenu={!!onMenu}
      onRetry={onRetry}
      onMenu={onMenu}
      onCommandSelect={onCommandSelect}
    />
  );
}

export default ErrorDisplay;
