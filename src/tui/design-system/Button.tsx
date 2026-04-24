import React from "react";
import { Text, useInput } from "../ink-custom";

// ============================================================================
// Button — Focusable button with Enter/Space activation
//
// Focused:   ▸ CONFIRM  (inverse text, bold)
// Unfocused: [ Confirm ] (bracketed, default)
// Disabled:  [ Confirm ] (dimmed, no interaction)
// ============================================================================

interface Props {
  label: string;
  onPress: () => void;
  focused?: boolean;
  disabled?: boolean;
  color?: string;
}

export function Button({ label, onPress, focused = false, disabled = false, color = "cyanBright" }: Props) {
  useInput(
    (input, key) => {
      if (disabled || !focused) return;
      if (key.return || input === " ") {
        onPress();
      }
    },
  );

  if (disabled) {
    return <Text dimColor>{"[ "}{label}{" ]"}</Text>;
  }

  if (focused) {
    return (
      <Text color={color} bold inverse>
        {" "}{label}{" "}
      </Text>
    );
  }

  return (
    <Text>
      {"[ "}
      <Text color={color}>{label}</Text>
      {" ]"}
    </Text>
  );
}
