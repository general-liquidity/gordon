// smoke — quick end-to-end smoke test for the custom renderer.
//
// Run: GORDON_CUSTOM_RENDER=1 bun run src/tui/ink-custom/smoke.ts
//
// Expected behavior: a single frame with a bordered box containing "hello,
// gordon" prints to stdout, then the process exits cleanly.
//
// This is a developer-facing sanity check, NOT a test — it's not wired to
// the test runner because it writes to the real stdout.

import React from "react";
import { render } from "./render.ts";
import Box from "./components/Box.ts";
import Text from "./components/Text.ts";

const App = () =>
  React.createElement(
    Box,
    { borderStyle: "round", padding: 1, flexDirection: "column" },
    React.createElement(Text, { color: "cyan" }, "hello, gordon"),
    React.createElement(Text, { dimColor: true }, "— custom ink renderer"),
  );

const instance = render(React.createElement(App), {
  patchConsole: false,
  exitOnCtrlC: true,
});

// Exit after a short delay so the frame has time to paint; in a real app
// the process waits on waitUntilExit().
setTimeout(() => {
  instance.unmount();
  process.exit(0);
}, 300);
