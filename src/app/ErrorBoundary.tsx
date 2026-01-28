import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { Box, Text } from "ink";

import { ErrorDisplay } from "./ErrorDisplay.tsx";

// Color palette
const COLORS = {
  TAN: "#d4a27f",
  TAN_DIM: "#b8896a",
  WHITE: "#e8e4de",
  DIM: "#a39e93",
  ERROR: "#e57373",
} as const;

interface ErrorBoundaryProps {
  children: ReactNode;
  onRetry?: () => void;
  onMenu?: () => void;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

function logError(error: Error, errorInfo: ErrorInfo): void {
  // Log to stderr for debugging without disrupting the terminal UI
  console.error("[Gordon Error]", error.message);
  console.error("[Gordon Stack]", error.stack);
  console.error("[Gordon Component Stack]", errorInfo.componentStack);
}

function formatErrorMessage(error: Error): string {
  // Provide user-friendly error messages for common error types
  const message = error.message.toLowerCase();

  if (message.includes("network") || message.includes("fetch")) {
    return "Unable to connect to the network. Please check your internet connection and try again.";
  }

  if (message.includes("api") || message.includes("unauthorized")) {
    return "There was an issue with your API connection. Please verify your credentials in setup.";
  }

  if (message.includes("timeout")) {
    return "The operation timed out. Please try again.";
  }

  if (message.includes("parse") || message.includes("json")) {
    return "Received unexpected data format. This might be a temporary issue.";
  }

  // Default friendly message
  return "An unexpected error occurred. Gordon will try to recover.";
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    logError(error, errorInfo);
  }

  handleRetry = (): void => {
    const { onRetry } = this.props;

    // Reset error state
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    // Call custom retry handler if provided
    if (onRetry) {
      onRetry();
    }
  };

  handleMenu = (): void => {
    const { onMenu } = this.props;

    // Reset error state
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    // Call custom menu handler if provided
    if (onMenu) {
      onMenu();
    }
  };

  override render(): ReactNode {
    const { children, fallback, onRetry, onMenu } = this.props;
    const { hasError, error } = this.state;

    if (hasError && error) {
      // Use custom fallback if provided
      if (fallback) {
        return fallback;
      }

      const friendlyMessage = formatErrorMessage(error);
      const showDetails = process.env.NODE_ENV === "development";

      return (
        <Box flexDirection="column" paddingY={1}>
          {/* Gordon branding in error state */}
          <Box paddingX={2} marginBottom={1}>
            <Text color={COLORS.TAN_DIM}>Gordon encountered an issue</Text>
          </Box>

          <ErrorDisplay
            title="Oops! Something went wrong"
            message={friendlyMessage}
            details={showDetails ? error.message : undefined}
            showRetry={Boolean(onRetry)}
            showMenu={Boolean(onMenu)}
            onRetry={this.handleRetry}
            onMenu={this.handleMenu}
          />

          {/* Recovery hint */}
          <Box paddingX={2} marginTop={1}>
            <Text color={COLORS.DIM}>
              If this keeps happening, try restarting Gordon or checking your
              configuration.
            </Text>
          </Box>
        </Box>
      );
    }

    return children;
  }
}

export default ErrorBoundary;
