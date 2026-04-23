import React from "react";
import { render } from "ink";
import { App } from "./App.js";

export async function startGordonTUI(): Promise<void> {
  const { waitUntilExit } = render(<App />, {
    // incrementalRendering: only write changed lines to stdout each frame
    // instead of erasing all lines and rewriting. Same principle as Claude
    // Code's blit optimization — ~80% reduction in terminal writes for a
    // stable conversation with only a spinner or streaming tail changing.
    incrementalRendering: true,
    // 60fps throttle matches Claude Code's FRAME_INTERVAL_MS=16.
    // Default Ink is 30fps (33ms). At 60fps, streaming text and animations
    // commit in the same frame window, preventing the spinner-vs-text
    // phase drift that causes visual stutter.
    maxFps: 60,
  });
  await waitUntilExit();

  // Keep-alive: on Windows, waitUntilExit() can resolve early.
  await new Promise<void>(() => {});
}
