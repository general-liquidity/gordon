import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";

/**
 * CodeBlock — Code display with language label, dimmed border, and
 * language-aware syntax highlighting via cli-highlight.
 *
 * Claude Code pattern: render unstyled code immediately (fast first paint),
 * lazy-load cli-highlight in the background, then re-render with the
 * highlighted output when ready. cli-highlight internally uses highlight.js
 * which adds ~300KB if eager-loaded, so we dynamically import only when a
 * code block is actually rendered.
 */

interface Props {
  code: string;
  language?: string;
}

// Lazy-load cli-highlight once per process. Promise is shared across all
// CodeBlock instances — first block triggers the load, subsequent blocks
// reuse the resolved module immediately.
let cliHighlightPromise: Promise<
  ((text: string, options: { language?: string; ignoreIllegals: boolean }) => string) | null
> | null = null;

function loadCliHighlight() {
  if (cliHighlightPromise) return cliHighlightPromise;
  cliHighlightPromise = import("cli-highlight")
    .then((mod) => {
      // cli-highlight exposes a `highlight` function as default or named export
      const fn = (mod as { highlight?: Function; default?: Function }).highlight
        ?? (mod as { default?: Function }).default;
      if (typeof fn !== "function") return null;
      return fn as (text: string, options: { language?: string; ignoreIllegals: boolean }) => string;
    })
    .catch(() => null);
  return cliHighlightPromise;
}

export function CodeBlock({ code, language }: Props) {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCliHighlight().then((highlightFn) => {
      if (cancelled) return;
      if (!highlightFn) {
        setLoadFailed(true);
        return;
      }
      try {
        const out = highlightFn(code, {
          language,
          ignoreIllegals: true,
        });
        setHighlighted(out);
      } catch {
        setLoadFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  // Render the code block. While cli-highlight loads, show unstyled code.
  // Once highlighted, swap in the highlighted version atomically.
  const lines = (highlighted ?? code).split("\n");
  // Remove trailing empty line if present
  if (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
    lines.pop();
  }

  return (
    <Box flexDirection="column" marginY={0} paddingLeft={2}>
      {/* Top border with language label */}
      <Box>
        <Text dimColor>
          {"\u250C"}{"\u2500"}
          {language ? ` ${language} ` : ""}
          {"\u2500".repeat(Math.max(1, 30 - (language?.length ?? 0)))}
        </Text>
      </Box>

      {/* Code lines. When cli-highlight has run, lines contain ANSI escapes
          that Ink's Text component renders transparently. */}
      {lines.map((line, i) => (
        <Box key={i}>
          <Text dimColor>{"\u2502"} </Text>
          {highlighted ? <Text>{line}</Text> : <Text dimColor>{line}</Text>}
        </Box>
      ))}

      {/* Bottom border */}
      <Box>
        <Text dimColor>
          {"\u2514"}{"\u2500".repeat(32)}
          {loadFailed ? " (unhighlighted)" : ""}
        </Text>
      </Box>
    </Box>
  );
}
