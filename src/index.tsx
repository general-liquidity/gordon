#!/usr/bin/env bun

import React from "react";
import { render } from "ink";
import { App } from "./app/App.tsx";

// Render the application
const { waitUntilExit } = render(<App />);

// Handle graceful shutdown
waitUntilExit().then(() => {
  process.exit(0);
});
