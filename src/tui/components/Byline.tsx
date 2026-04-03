import React from "react";
import { Text } from "ink";

// ============================================================================
// Byline — Metadata joined with middot separator
// "Scanner · 1.2K tokens · 3.2s"
// ============================================================================

interface Props {
  parts: (string | null | undefined | false)[];
}

export function Byline({ parts }: Props) {
  const filtered = parts.filter(Boolean) as string[];
  if (filtered.length === 0) return null;

  return (
    <Text dimColor>
      {filtered.join(" \u00b7 ")}
    </Text>
  );
}
