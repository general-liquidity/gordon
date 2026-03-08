import React from "react";
import { Box, Text } from "ink";
import { Alert, ConfirmInput, Select } from "@inkjs/ui";
import { getAlertAccent } from "../componentTheme.ts";
import { COLORS } from "../theme.ts";

export interface NoticeAlertProps {
  title: string;
  variant?: "info" | "warning" | "error" | "success";
  children: React.ReactNode;
}

export function NoticeAlert({
  title,
  variant = "info",
  children,
}: NoticeAlertProps): React.ReactElement {
  const content = typeof children === "string"
    ? <Text color={getAlertAccent(variant)}>{children}</Text>
    : children;

  return (
    <Box paddingX={1}>
      <Alert variant={variant} title={title}>
        <Box flexDirection="column">{content}</Box>
      </Alert>
    </Box>
  );
}

export interface ConfirmationPromptProps {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationPrompt({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmationPromptProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text color={COLORS.WHITE} bold>{title}</Text>
      {description && (
        <Text color={COLORS.DIM}>{description}</Text>
      )}
      <Box marginTop={1}>
        <ConfirmInput
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
        <Text color={COLORS.DIM}> {confirmLabel} / {cancelLabel}</Text>
      </Box>
    </Box>
  );
}

export interface FocusSelectOption {
  label: string;
  value: string;
}

export interface FocusSelectProps {
  title?: string;
  hint?: string;
  options: FocusSelectOption[];
  onChange: (value: string) => void;
  defaultValue?: string;
}

export function FocusSelect({
  title,
  hint,
  options,
  onChange,
  defaultValue,
}: FocusSelectProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {title && (
        <Text color={COLORS.WHITE} bold>{title}</Text>
      )}
      {hint && (
        <Text color={COLORS.DIM}>{hint}</Text>
      )}
      <Select
        options={options}
        defaultValue={defaultValue}
        onChange={onChange}
      />
    </Box>
  );
}
