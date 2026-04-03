import React from "react";
import { render } from "ink";
import { App } from "./App.js";

// ============================================================================
// Gordon TUI Entry Point
//
// Renders the Ink app and blocks until exit.
// On Windows, waitUntilExit() may resolve immediately — the keep-alive
// promise ensures the process stays alive for Ink's render loop.
// ============================================================================

export async function startGordonTUI(): Promise<void> {
  const { waitUntilExit } = render(<App />);
  await waitUntilExit();

  // Keep-alive: on Windows, waitUntilExit() can resolve early.
  // The process stays alive until Ctrl+C triggers the App's exit handler.
  await new Promise<void>(() => {});
}
