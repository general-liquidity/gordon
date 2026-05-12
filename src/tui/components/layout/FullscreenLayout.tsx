import React, { createContext, useContext, useRef, type ReactNode } from "react";
import { Box, Text, useStdout } from "../../ink-custom";
import type { ScrollBoxHandle } from "./ScrollBox.js";

// ============================================================================
// FullscreenLayout — Three-zone terminal layout
//
// ┌─ HEADER ─────────────────────────────────┐
// │ Scrollable content zone                  │
// │ (fills remaining space)                  │
// ├──────────────────────────────────────────┤
// │ Status bar (1 row)                       │
// ├──────────────────────────────────────────┤
// │ Input zone (bottom, fixed)               │
// └──────────────────────────────────────────┘
//
// Overlay renders on top of content zone when present.
// ============================================================================

interface LayoutContext {
  contentHeight: number;
  scrollRef: React.RefObject<ScrollBoxHandle | null>;
}

const FullscreenLayoutContext = createContext<LayoutContext>({
  contentHeight: 20,
  scrollRef: { current: null },
});

export function useFullscreenLayout(): LayoutContext {
  return useContext(FullscreenLayoutContext);
}

interface Props {
  header: ReactNode;
  content: ReactNode;
  statusBar: ReactNode;
  input: ReactNode;
  overlay?: ReactNode;
  headerHeight?: number;
  inputHeight?: number;
}

export function FullscreenLayout({
  header,
  content,
  statusBar,
  input,
  overlay,
  headerHeight = 3,
  inputHeight = 2,
}: Props) {
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const scrollRef = useRef<ScrollBoxHandle | null>(null);

  // Content height = total rows - header - status bar (1) - input
  const contentHeight = Math.max(5, rows - headerHeight - 1 - inputHeight);

  const ctx: LayoutContext = { contentHeight, scrollRef };

  return (
    <FullscreenLayoutContext.Provider value={ctx}>
      <Box flexDirection="column" height={rows}>
        {/* Header zone */}
        <Box flexDirection="column" height={headerHeight}>
          {header}
        </Box>

        {/* Content zone (scrollable) */}
        <Box flexDirection="column" flexGrow={1} height={contentHeight}>
          {content}
          {/* Overlay floats on top */}
          {overlay ? (
            <Box flexDirection="column" marginTop={-contentHeight}>
              {overlay}
            </Box>
          ) : null}
        </Box>

        {/* Status bar (1 row) */}
        <Box height={1}>
          <Text dimColor>{"\u2500".repeat(stdout?.columns ?? 80)}</Text>
        </Box>
        <Box height={1}>
          {statusBar}
        </Box>

        {/* Input zone (fixed at bottom) */}
        <Box flexDirection="column">
          {input}
        </Box>
      </Box>
    </FullscreenLayoutContext.Provider>
  );
}
