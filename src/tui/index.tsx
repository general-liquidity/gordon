import React from "react";
import { render } from "ink";
import { App } from "./App.js";
// ============================================================================
// Gordon TUI Entry Point
//
// Rendering optimizations (LineDiffRenderer, StringWidthCache, StyleCache)
// are available in src/tui/rendering/ but NOT active by default.
// Stock Ink's rendering works correctly. Enable line-diff only after
// thorough testing — it patches stdout.write which can conflict with
// Ink's cursor management.
// ============================================================================

export async function startGordonTUI(): Promise<void> {
  const { waitUntilExit } = render(<App />);
  await waitUntilExit();

  // Keep-alive: on Windows, waitUntilExit() can resolve early.
  // The process stays alive until Ctrl+C triggers the App's exit handler.
  await new Promise<void>(() => {});
}
