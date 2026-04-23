import React from "react";
import { render } from "ink";
import { App } from "./App.js";

export async function startGordonTUI(): Promise<void> {
  const { waitUntilExit } = render(<App />, {
    // incrementalRendering: ScrollBox calls global.__inkClearIncrementalOutput on scroll,
    // forcing a full repaint for scroll frames and avoiding line-diff text bleed.
    incrementalRendering: true,
    maxFps: 60,
  });
  await waitUntilExit();

  // Keep-alive: on Windows, waitUntilExit() can resolve early.
  await new Promise<void>(() => {});
}
