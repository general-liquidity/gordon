import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

import { COLORS } from "../theme.ts";
import { DeskPanel, type DeskTone } from "./desk/DeskPanel.tsx";

type AlertVariant = "info" | "warning" | "error" | "success";

function variantToTone(variant: AlertVariant): DeskTone {
  switch (variant) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "error":
      return "danger";
    case "info":
    default:
      return "info";
  }
}

export const NoticeAlert: React.FC<{
  title: string;
  variant?: AlertVariant;
  children?: React.ReactNode;
}> = ({ title, variant = "info", children }) => (
  <DeskPanel eyebrow="Notice" title={title} tone={variantToTone(variant)} compact>
    {children}
  </DeskPanel>
);

export const ConfirmationPrompt: React.FC<{
  title: string;
  description?: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ title, description, onConfirm, onCancel }) => {
  useInput((input, key) => {
    if (key.return || input.toLowerCase() === "y") {
      onConfirm();
    } else if (key.escape || input.toLowerCase() === "n") {
      onCancel();
    }
  });

  return (
    <DeskPanel eyebrow="Confirm" title={title} subtitle={description} tone="warning" compact>
      <Text color={COLORS.DIM}>Enter or Y confirms. Esc or N cancels.</Text>
    </DeskPanel>
  );
};

export interface FocusSelectOption<T extends string = string> {
  label: string;
  value: T;
  detail?: string;
}

export function FocusSelect<T extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: FocusSelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
}): React.ReactElement {
  const initialIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  useInput((input, key) => {
    if (options.length === 0) return;
    if (key.upArrow) {
      setSelectedIndex((current) => (current - 1 + options.length) % options.length);
    } else if (key.downArrow) {
      setSelectedIndex((current) => (current + 1) % options.length);
    } else if (key.return) {
      onChange(options[selectedIndex]!.value);
    } else if (/^[1-9]$/u.test(input)) {
      const index = Number.parseInt(input, 10) - 1;
      if (index >= 0 && index < options.length) {
        setSelectedIndex(index);
        onChange(options[index]!.value);
      }
    }
  });

  return (
    <DeskPanel eyebrow="Select" title={title} tone="info" compact>
      <Box flexDirection="column">
        {options.map((option, index) => {
          const active = index === selectedIndex;
          return (
            <Text key={option.value} color={active ? COLORS.BRASS : COLORS.WHITE}>
              {active ? ">" : " "} {index + 1}. {option.label}
              {option.detail ? <Text color={COLORS.DIM}> · {option.detail}</Text> : null}
            </Text>
          );
        })}
      </Box>
    </DeskPanel>
  );
}

