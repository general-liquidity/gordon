import React from "react";
import { Text } from "../ink-custom";
import { formatKeys } from "./KeyboardShortcutHint.tsx";

export interface KeyHint {
  keys: string;
  label: string;
}

export function KeyboardHints({ hints }: { hints: KeyHint[] }): React.ReactElement | null {
  if (hints.length === 0) return null;
  return (
    <Text dimColor>
      {hints.map((hint, index) => (
        <React.Fragment key={`${hint.keys}-${hint.label}`}>
          {index > 0 ? " · " : ""}
          <Text dimColor>{formatKeys(hint.keys)}</Text> <Text dimColor>{hint.label}</Text>
        </React.Fragment>
      ))}
    </Text>
  );
}
