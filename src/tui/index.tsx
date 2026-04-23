import React from "react";
import { render } from "ink";
import { App } from "./App.js";

export async function startGordonTUI(): Promise<void> {
  const { waitUntilExit } = render(<App />, {
    // incrementalRendering disabled: conflicts with ScrollBox's marginTop=-scrollTop
    // scroll mechanism. When scrollTop changes all line positions shift together,
    // causing Ink's line-diff to write content to wrong terminal rows (text bleed).
    // incrementalRendering: true,
    maxFps: 60,
  });
  await waitUntilExit();

  // Keep-alive: on Windows, waitUntilExit() can resolve early.
  await new Promise<void>(() => {});
}
