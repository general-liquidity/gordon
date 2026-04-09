import React from "react";
import { render } from "ink";
import { App } from "./App.js";
import { installLineDiffRenderer, resetLineDiffCache } from "./rendering/LineDiffRenderer.js";

// ============================================================================
// Gordon TUI Entry Point
//
// Renders the Ink app with line-diff rendering optimization.
// Stock Ink re-renders ALL lines every frame. The LineDiffRenderer
// patches stdout.write to only emit changed lines — ~80% of Claude
// Code's custom Ink fork performance without forking.
// ============================================================================

export async function startGordonTUI(): Promise<void> {
  // Install rendering optimization before Ink starts
  const cleanupRenderer = installLineDiffRenderer();

  // Reset diff cache on terminal resize
  process.stdout.on("resize", resetLineDiffCache);

  const { waitUntilExit } = render(<App />);
  await waitUntilExit();

  // Cleanup
  cleanupRenderer();

  // Keep-alive: on Windows, waitUntilExit() can resolve early.
  // The process stays alive until Ctrl+C triggers the App's exit handler.
  await new Promise<void>(() => {});
}
