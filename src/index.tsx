#!/usr/bin/env bun

// Install the Dedalus max_tokens guard before any LLM module loads.
// Patches global fetch so Mastra-internal routing-agent calls (which
// don't inherit our agent-level defaultOptions / defaultNetworkOptions)
// can't blow the non-streaming threshold and 400 the user. Idempotent.
// Also cloaks the noisy "Upstream LLM API error from dedalus" stack
// dumps so demos / live sessions don't get interrupted — set
// GORDON_SHOW_DEDALUS_ERRORS=1 to see them again while debugging.
import { installDedalusMaxTokensGuard, cloakDedalusErrors } from "./infra/runtime/dedalusMaxTokensGuard.ts";
installDedalusMaxTokensGuard();
cloakDedalusErrors();
import { installOutboundFetchGuard } from "./infra/safety/outboundFetchGuard.ts";
import { installFilesystemWriteGuard } from "./infra/safety/filesystemWriteGuardInstaller.ts";
installOutboundFetchGuard();
installFilesystemWriteGuard();

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

// --json alone prints the status overview; --json combined with --headless
// switches the headless runner into structured-output mode instead. Check
// headless first so the combined flag set routes correctly.
if (flags.json && !flags.headless) {
  await printStatusJson();
  process.exit(0);
}

if (flags.cleanup) {
  await runCleanup();
  process.exit(0);
}

if (flags.headless) {
  // Quiet stdout-only mode for cron / pipeline use. Pass anything after
  // the `--headless` flag (and other recognised flags) as the prompt.
  const promptArgs = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const { runHeadlessAndPrint } = await import("./app/models/headless.ts");
  const code = await runHeadlessAndPrint(promptArgs, flags.quiet, flags.json);
  process.exit(code);
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

// Skip interactive update prompt — it blocks stdin before TUI loads
// Users can manually update via `gordon --upgrade`
const updateResult = "skipped";

import { checkLicense, shutdownLicense } from "./infra/external/license/index.ts";
await checkLicense();

// ============================================================================
// TUI Launch
// ============================================================================

import { startGordonTUI } from "./tui/index.js";
import { closeDatabase } from "./infra/storage/database.ts";
import { emitEvent } from "./events/index.ts";
import { loadConfig } from "./infra/storage/config/config.ts";
import {
  initializeStructuredAxiom,
  shutdownStructuredAxiom,
} from "./infra/platform/observability/index.ts";
import * as telemetry from "./infra/platform/telemetry/index.ts";
import { disconnectMCP } from "./infra/ai/mcp/client.ts";

let isShuttingDown = false;

async function gracefulShutdown(signal: string, code: number = 0): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (signal === "SIGINT") {
    // Warn about active positions on Ctrl-C
    try {
      const { loadConfig } = await import("./infra/storage/config/config.ts");
      const config = await loadConfig();
      if (config.permissionMode === "auto") {
        console.log("\n[warn] permissionMode is 'auto'. Open positions will continue on the exchange.");
        console.log("       Use /ask before exiting if you want per-action approval next session.");
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
    const { stopProactiveObserver, isObserverRunning } = await import(
      "./infra/proactive/engine/observer.ts"
    );
    if (isObserverRunning()) {
      stopProactiveObserver();
    }
  } catch {
    // Non-critical — observer may not have been started this session
  }

  try {
    closeDatabase();
  } catch (error) {
    console.error("Error during shutdown:", error);
    if (code === 0) code = 1;
  }

  process.exit(code);
}

// Signal handlers — let Ink handle Ctrl+C (App has double-press guard).
// SIGTERM and SIGHUP are POSIX-only; Windows ignores them silently
// which previously hid the fact that graceful shutdown wasn't wired
// on Windows. Skip the handler registration entirely on win32.
if (process.platform !== "win32") {
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));
}

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

// Initialize multi-sink event router
try {
  const { initSinks } = await import("./infra/platform/telemetry/sinks.ts");
  initSinks();
} catch {
  // Non-fatal — telemetry already runs through legacy path
}

// Run data retention sweep at startup (best-effort, fire-and-forget)
try {
  const { sweepRetentionOnStartup } = await import("./infra/platform/dataRetention.ts");
  sweepRetentionOnStartup().catch(() => {});
} catch {
  // Non-fatal
}

// Classify config-load failures into a TUI-visible sentinel instead of crashing.
function classifyConfigError(err: unknown): "syntax" | "settings" | null {
  if (!err || typeof err !== "object") return null;
  if (err instanceof SyntaxError) return "syntax";
  const e = err as { name?: string; issues?: unknown };
  if (e.name === "ZodError" || Array.isArray(e.issues)) return "settings";
  return null;
}

// Wire: parallel startup — run config + observability concurrently
try {
  const { runParallelStartup, configLoadTask, memoryLoadTask } = await import("./infra/runtime/parallelStartup.ts");
  const { formatMemoriesForPrompt } = await import("./infra/memory/sessionMemory.ts");
  const { setCliOverrides } = await import("./infra/config/settingsLayers.ts");

  // Pass any CLI flag overrides to the 7-level settings layer
  if ((flags as unknown as Record<string, unknown>).permissionMode) setCliOverrides({ permissionMode: (flags as unknown as Record<string, unknown>).permissionMode as string });

  const startupResult = await runParallelStartup([
    configLoadTask(() => loadConfig()),
    memoryLoadTask(async () => formatMemoriesForPrompt()),
  ]);

  const configTask = startupResult.tasks.find((t) => t.id === "config");
  if (configTask && !configTask.success) {
    const kind = classifyConfigError(configTask.error);
    if (kind) {
      process.env.GORDON_CONFIG_ERROR_TYPE = kind;
      process.env.GORDON_CONFIG_ERROR_MSG = String(configTask.error ?? "Unknown config error");
    }
  }

  const startupConfig = configTask?.result as { permissionMode?: string } | undefined;
  const startupPermissionMode = startupConfig?.permissionMode;
  const narrowedStartupMode: "auto" | "ask" | "strict" =
    startupPermissionMode === "auto" || startupPermissionMode === "ask" || startupPermissionMode === "strict"
      ? startupPermissionMode
      : "ask";
  await emitEvent("system:started", { permissionMode: narrowedStartupMode });
} catch (err) {
  const kind = classifyConfigError(err);
  if (kind) {
    process.env.GORDON_CONFIG_ERROR_TYPE = kind;
    process.env.GORDON_CONFIG_ERROR_MSG = err instanceof Error ? err.message : String(err);
  }
  // Fallback: sequential startup if parallel fails
  try {
    const startupConfig = await loadConfig();
    const fallbackPermissionMode: "auto" | "ask" | "strict" =
      startupConfig.permissionMode === "auto" || startupConfig.permissionMode === "ask" || startupConfig.permissionMode === "strict"
        ? startupConfig.permissionMode
        : "ask";
    await emitEvent("system:started", { permissionMode: fallbackPermissionMode });
  } catch (err2) {
    const k2 = classifyConfigError(err2);
    if (k2 && !process.env.GORDON_CONFIG_ERROR_TYPE) {
      process.env.GORDON_CONFIG_ERROR_TYPE = k2;
      process.env.GORDON_CONFIG_ERROR_MSG = err2 instanceof Error ? err2.message : String(err2);
    }
  }
}

// Launch the rebuilt cockpit shell
process.env.GORDON_APP_READY = "1";

await startGordonTUI();

await gracefulShutdown("exit");
