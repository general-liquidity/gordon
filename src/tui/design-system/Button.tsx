import type React from "react";
import { Text, useInput } from "../ink-custom";
import type { GordonTheme } from "../themes/themes.ts";
import { useTheme } from "../themes/ThemeProvider.tsx";

// ============================================================================
// Button — Focusable button with Enter/Space activation
//
// Focused:   ▸ CONFIRM  (inverse text, bold)
// Unfocused: [ Confirm ] (bracketed, default)
// Disabled:  [ Confirm ] (dimmed, no interaction)
// ============================================================================

export type ButtonVariant = "primary" | "success" | "danger" | "neutral";

interface Props {
  label: string;
  onPress: () => void;
  focused?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
}

interface ButtonComponent {
  (props: Props): React.ReactElement;
  Primary: (props: Omit<Props, "variant">) => React.ReactElement;
  Success: (props: Omit<Props, "variant">) => React.ReactElement;
  Danger: (props: Omit<Props, "variant">) => React.ReactElement;
  Neutral: (props: Omit<Props, "variant">) => React.ReactElement;
}

export function buttonVariantColor(variant: ButtonVariant, theme: GordonTheme): string {
  switch (variant) {
    case "primary":
      return theme.uiBrand;
    case "success":
      return theme.riskSafe;
    case "danger":
      return theme.riskDanger;
    case "neutral":
      return theme.uiMuted;
  }
}

function ButtonImpl({
  label,
  onPress,
  focused = false,
  disabled = false,
  variant = "primary",
}: Props) {
  const color = buttonVariantColor(variant, useTheme());
  const colorProps = { color };

  useInput((input, key) => {
    if (disabled || !focused) return;
    if (key.return || input === " ") {
      onPress();
    }
  });

  if (disabled) {
    return (
      <Text dimColor>
        {"[ "}
        {label}
        {" ]"}
      </Text>
    );
  }

  if (focused) {
    return (
      <Text {...colorProps} bold inverse>
        {" "}
        {label}{" "}
      </Text>
    );
  }

  return (
    <Text>
      {"[ "}
      <Text {...colorProps}>{label}</Text>
      {" ]"}
    </Text>
  );
}

export const Button = Object.assign(ButtonImpl, {
  Primary: (props: Omit<Props, "variant">) => <ButtonImpl {...props} variant="primary" />,
  Success: (props: Omit<Props, "variant">) => <ButtonImpl {...props} variant="success" />,
  Danger: (props: Omit<Props, "variant">) => <ButtonImpl {...props} variant="danger" />,
  Neutral: (props: Omit<Props, "variant">) => <ButtonImpl {...props} variant="neutral" />,
}) satisfies ButtonComponent;
