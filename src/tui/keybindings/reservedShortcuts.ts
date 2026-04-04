// ============================================================================
// Reserved Shortcuts — Keys that cannot be rebound
// ============================================================================

export const RESERVED_SHORTCUTS = ["ctrl+c", "ctrl+d", "ctrl+m"] as const;

export function isReserved(keystroke: string): boolean {
  return RESERVED_SHORTCUTS.includes(keystroke.toLowerCase() as any);
}
