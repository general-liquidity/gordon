#!/usr/bin/env bun

import {
  parseCommand,
  parseFlags,
  shouldUseColor,
  printHelp,
  printVersion,
  printStatusJson,
  checkRuntime,
  runCleanup,
  runUninstall,
  hasStdinData,
} from "./cli.ts";
import { runCLICommand } from "./gateway/cli-commands.ts";

// ============================================================================
// CLI Flag Handling — runs before TUI loads
// ============================================================================

const flags = parseFlags();
const command = parseCommand();

if (command) {
  const result = await runCLICommand(command);
  if (result.exit) {
    process.exit(result.code ?? 0);
  }
}

if (flags.help) {
  printHelp();
  process.exit(0);
}

if (flags.version) {
  printVersion();
  process.exit(0);
}

if (flags.json) {
  await printStatusJson();
  process.exit(0);
}

if (flags.cleanup) {
  await runCleanup();
  process.exit(0);
}

if (flags.uninstall) {
  await runUninstall();
  process.exit(0);
}

// Runtime version check
const runtimeError = checkRuntime();
if (runtimeError) {
  console.error(`[error] ${runtimeError}`);
  process.exit(1);
}

// Debug mode — set LOG_LEVEL before any logger is imported
if (flags.debug) {
  process.env.LOG_LEVEL = "debug";
}

// Set NO_COLOR for Ink/chalk when colors should be disabled
if (!shouldUseColor(flags)) {
  process.env.NO_COLOR = "1";
}

// Detect piped stdin — can be used by agents for batch input
if (hasStdinData()) {
  process.env.GORDON_STDIN_PIPED = "1";
}

// ============================================================================
// License Check — must pass before TUI loads
// ============================================================================

import { checkLicense, shutdownLicense } from "./infra/license/index.ts";
await checkLicense();

// ============================================================================
// TUI Launch
// ============================================================================

import React from "react";
import { render } from "ink";
import { AppWithTheme } from "./app/App.tsx";
import { closeDatabase } from "./infra/storage/database.ts";
import { checkForUpdates } from "./utils/update-notifier.ts";
import * as telemetry from "./infra/telemetry/index.ts";
import { disconnectMCP } from "./infra/mcp/client.ts";

let isShuttingDown = false;

async function gracefulShutdown(signal: string, code: number = 0): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (signal === "SIGINT") {
    // Warn about active positions on Ctrl-C
    try {
      const { loadConfig } = await import("./infra/storage/config.ts");
      const config = await loadConfig();
      if (config.mode === "ARMED") {
        console.log("\n[warn] System is ARMED. Open positions will continue on the exchange.");
        console.log("       Use /disarm before exiting to return to safe mode.");
      }
    } catch {
      // Config may not be loadable during crash
    }
    console.log(`\nShutting down...`);
  } else if (signal !== "exit") {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
  }

  try {
    await shutdownLicense();
  } catch {
    // Non-critical
  }

  try {
    await telemetry.shutdown();
  } catch {
    // Non-critical
  }

  try {
    await disconnectMCP();
  } catch {
    // Non-critical
  }

  try {
    closeDatabase();
  } catch (error) {
    console.error("Error during shutdown:", error);
    if (code === 0) code = 1;
  }

  process.exit(code);
}

// Register signal handlers
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));

// Uncaught exceptions exit with code 1
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  gracefulShutdown("uncaughtException", 1);
});

// Unhandled promise rejections — log but don't exit
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
});

// Initialize telemetry (no-op if not opted in)
telemetry.init();

// Render the application with theme support
const { waitUntilExit } = render(<AppWithTheme />);

// Non-blocking update check — runs after TUI renders, never delays startup
checkForUpdates().catch(() => {});

waitUntilExit().then(() => {
  gracefulShutdown("exit");
});
