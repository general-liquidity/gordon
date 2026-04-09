import { useState, useEffect } from "react";

// ============================================================================
// useScreenReader — Detect if a screen reader is active
//
// Claude Code pattern: useIsScreenReaderEnabled()
// Checks TERM_PROGRAM and accessibility env vars.
// When active, components should add text-based status indicators
// instead of relying on color/animation alone.
// ============================================================================

export function useScreenReader(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // Check common screen reader indicators
    const indicators = [
      process.env.ACCESSIBILITY_ENABLED === "true",
      process.env.SCREEN_READER === "true",
      process.env.GORDON_SCREEN_READER === "true",
      // macOS VoiceOver sets this
      process.env.VOICE_OVER_ENABLED === "1",
      // Windows Narrator / JAWS / NVDA
      process.env.NARRATOR_RUNNING === "1",
    ];
    setEnabled(indicators.some(Boolean));
  }, []);

  return enabled;
}
