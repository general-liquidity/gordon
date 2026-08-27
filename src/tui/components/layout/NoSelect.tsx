import { Text } from "../../ink-custom";

// ============================================================================
// NoSelect — Prevents terminal text selection of decorative characters
//
// Claude Code pattern: wraps ⎿ hook characters so they don't get copied
// when the user selects text in the terminal.
// Uses zero-width spaces around the character to break selection.
// ============================================================================

interface Props {
  children: string;
}

export function NoSelect({ children }: Props) {
  // Zero-width space (U+200B) before and after breaks text selection
  return (
    <Text dimColor>
      {"\u200B"}
      {children}
      {"\u200B"}
    </Text>
  );
}
