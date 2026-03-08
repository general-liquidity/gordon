/**
 * Status Message Components
 * Uses ink-ui Alert and StatusMessage for consistent feedback
 */

import React from "react";
import { Box, Text } from "ink";
import { StatusMessage } from "@inkjs/ui";
import { COLORS } from "../theme.ts";
import { NoticeAlert } from "./PromptPrimitives.tsx";

/**
 * Success message for completed operations
 */
interface SuccessMessageProps {
  title: string;
  message?: string;
}

export const SuccessMessage: React.FC<SuccessMessageProps> = ({
  title,
  message,
}) => {
  return (
    <Box paddingX={2} paddingY={1}>
      <StatusMessage variant="success">
        <Text bold>{title}</Text>
        {message && <Text color={COLORS.DIM}> - {message}</Text>}
      </StatusMessage>
    </Box>
  );
};

/**
 * Error message for failed operations
 */
interface ErrorMessageProps {
  title: string;
  message?: string;
  suggestion?: string;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({
  title,
  message,
  suggestion,
}) => {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <StatusMessage variant="error">
        <Text bold>{title}</Text>
        {message && <Text color={COLORS.DIM}> - {message}</Text>}
      </StatusMessage>
      {suggestion && (
        <Box paddingLeft={2} marginTop={1}>
          <Text color={COLORS.DIM}>Suggestion: {suggestion}</Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Warning alert for important notices
 */
interface WarningAlertProps {
  title: string;
  children: React.ReactNode;
}

export const WarningAlert: React.FC<WarningAlertProps> = ({
  title,
  children,
}) => {
  return (
    <Box paddingX={2} paddingY={1}>
      <NoticeAlert title={title} variant="warning">{children}</NoticeAlert>
    </Box>
  );
};

/**
 * Info alert for helpful information
 */
interface InfoAlertProps {
  title: string;
  children: React.ReactNode;
}

export const InfoAlert: React.FC<InfoAlertProps> = ({
  title,
  children,
}) => {
  return (
    <Box paddingX={2} paddingY={1}>
      <NoticeAlert title={title} variant="info">{children}</NoticeAlert>
    </Box>
  );
};

/**
 * Risk warning specifically for trading
 */
interface RiskWarningProps {
  riskLevel: "low" | "medium" | "high";
  message: string;
}

export const RiskWarning: React.FC<RiskWarningProps> = ({
  riskLevel,
  message,
}) => {
  const variants: Record<typeof riskLevel, "info" | "warning" | "error"> = {
    low: "info",
    medium: "warning",
    high: "error",
  };

  const titles: Record<typeof riskLevel, string> = {
    low: "Low Risk",
    medium: "Medium Risk",
    high: "High Risk",
  };

  return (
    <Box paddingX={2} paddingY={1}>
      <NoticeAlert title={titles[riskLevel]} variant={variants[riskLevel]}>
        <Text>{message}</Text>
      </NoticeAlert>
    </Box>
  );
};

/**
 * Connection status indicator
 */
interface ConnectionAlertProps {
  isConnected: boolean;
  service: string;
}

export const ConnectionAlert: React.FC<ConnectionAlertProps> = ({
  isConnected,
  service,
}) => {
  if (isConnected) {
    return (
      <StatusMessage variant="success">
        Connected to {service}
      </StatusMessage>
    );
  }

  return (
    <NoticeAlert title={`${service} Disconnected`} variant="error">
      <Text>Please check your API keys and network connection.</Text>
    </NoticeAlert>
  );
};

export default {
  SuccessMessage,
  ErrorMessage,
  WarningAlert,
  InfoAlert,
  RiskWarning,
  ConnectionAlert,
};
