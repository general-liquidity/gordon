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

// ============================================================================
// CLI Flag Handling — runs before TUI loads
// ============================================================================

const flags = parseFlags();
const command = parseCommand();

if (command) {
  const { runCLICommand } = await import("./gateway/cli-commands.ts");
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
  process.env.GORDON_STARTUP_QUIET = "0";
} else {
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";
  process.env.GORDON_STARTUP_QUIET = process.env.GORDON_STARTUP_QUIET || "1";
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

import { maybePromptForUpdate, runSelfUpgrade } from "./utils/update-notifier.ts";

if (flags.upgrade) {
  const result = await runSelfUpgrade();
  if (result === "updated") {
    process.exit(0);
  }
  if (result === "unsupported") {
    console.error("This Gordon install channel does not support in-place self-upgrade. Reinstall the latest release manually.");
    process.exit(1);
  }
  console.error("Gordon update failed. Retry `gordon --upgrade` or reinstall manually.");
  process.exit(1);
}

const updateResult = await maybePromptForUpdate();
if (updateResult === "updated") {
  process.exit(0);
}

import { checkLicense, shutdownLicense } from "./infra/license/index.ts";
await checkLicense();

// ============================================================================
// TUI Launch
// ============================================================================

import React from "react";
import { render } from "ink";
import { AppWithTheme } from "./app/index.ts";
import { closeDatabase } from "./infra/storage/database.ts";
import { emitEvent } from "./events/index.ts";
import { loadConfig } from "./infra/storage/config.ts";
import {
  initializeStructuredAxiom,
  shutdownStructuredAxiom,
} from "./infra/observability/index.ts";
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
    await shutdownStructuredAxiom();
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
initializeStructuredAxiom();

try {
  const startupConfig = await loadConfig();
  await emitEvent("system:started", { mode: startupConfig.mode });
} catch {
  // Non-critical startup observability path
}

// Render the application with theme support
process.env.GORDON_APP_READY = "1";
const { waitUntilExit } = render(<AppWithTheme />);

waitUntilExit().then(() => {
  gracefulShutdown("exit");
});
