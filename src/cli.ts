/**
 * CLI argument parsing and pre-TUI commands
 * Handles --help, --version, --json, --no-color, --plain, --debug, --cleanup, --uninstall
 * Supports POSIX short option grouping (e.g., -hv = --help --version)
 */

import { GORDON_DIR } from "./infra/storage/paths.ts";
import { GORDON_VERSION } from "./version.ts";

const VERSION = GORDON_VERSION;
const MIN_BUN_VERSION = "1.0.0";

export interface CLIFlags {
  help: boolean;
  version: boolean;
  json: boolean;
  plain: boolean;
  noColor: boolean;
  debug: boolean;
  cleanup: boolean;
  uninstall: boolean;
  upgrade: boolean;
  /** Run a single prompt with no TUI; print response to stdout and exit. */
  headless: boolean;
  /** Suppress the stderr event-log when running headless. */
  quiet: boolean;
}

export type ParsedCLICommand =
  | { name: "daemon"; action: "start" | "run" | "stop" | "status" }
  | { name: "schedule"; action: "add" | "remove" | "list"; args: string[] }
  | { name: "init"; args: string[] }
  | { name: "doctor"; args: string[] }
  | { name: "configure"; args: string[] }
  | { name: "bootstrap"; args: string[] };

/** Short flag → long flag mapping */
const SHORT_FLAGS: Record<string, keyof CLIFlags> = {
  h: "help",
  v: "version",
  d: "debug",
};

/** Long flag → CLIFlags key mapping */
const LONG_FLAGS: Record<string, keyof CLIFlags> = {
  "--help": "help",
  "--version": "version",
  "--json": "json",
  "--plain": "plain",
  "--no-color": "noColor",
  "--debug": "debug",
  "--verbose": "debug",
  "--cleanup": "cleanup",
  "--uninstall": "uninstall",
  "--upgrade": "upgrade",
  "--headless": "headless",
  "--quiet": "quiet",
};

export function parseFlags(): CLIFlags {
  const args = process.argv.slice(2);
  const flags: CLIFlags = {
    help: false,
    version: false,
    json: false,
    plain: false,
    noColor: false,
    debug: false,
    cleanup: false,
    uninstall: false,
    upgrade: false,
    headless: false,
    quiet: false,
  };

  for (const arg of args) {
    // Long flags: --help, --version, etc.
    if (arg.startsWith("--")) {
      const key = LONG_FLAGS[arg];
      if (key) flags[key] = true;
      continue;
    }

    // Short flags with grouping: -h, -v, -hv, -dvh, etc.
    if (arg.startsWith("-") && arg.length > 1) {
      for (const ch of arg.slice(1)) {
        const key = SHORT_FLAGS[ch];
        if (key) flags[key] = true;
      }
    }
  }

  return flags;
}

/**
 * Parse non-flag CLI commands like:
 * - gordon daemon start
 * - gordon schedule add ...
 * - gordon init
 */
export function parseCommand(): ParsedCLICommand | null {
  const args = process.argv.slice(2);
  if (args.length === 0) return null;

  const command = args[0];
  if (!command || command.startsWith("-")) return null;

  if (command === "daemon") {
    const action = (args[1] || "status") as "start" | "run" | "stop" | "status";
    if (action === "start" || action === "run" || action === "stop" || action === "status") {
      return { name: "daemon", action };
    }
  }

  if (command === "schedule") {
    const action = (args[1] || "list") as "add" | "remove" | "list";
    if (action === "add" || action === "remove" || action === "list") {
      return { name: "schedule", action, args: args.slice(2) };
    }
  }

  if (command === "init") {
    return { name: "init", args: args.slice(1) };
  }

  if (command === "doctor") {
    return { name: "doctor", args: args.slice(1) };
  }

  if (command === "configure") {
    return { name: "configure", args: args.slice(1) };
  }

  if (command === "bootstrap") {
    return { name: "bootstrap", args: args.slice(1) };
  }

  return null;
}

/**
 * Determines if color output should be used.
 * Checks flags, NO_COLOR env, TERM=dumb, and TTY status.
 */
export function shouldUseColor(flags: CLIFlags): boolean {
  if (flags.noColor || flags.plain) return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  if (process.env.TERM === "dumb") return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

/**
 * Check if stdin has piped data (non-interactive).
 */
export function hasStdinData(): boolean {
  return !process.stdin.isTTY;
}

/**
 * Check if the Bun runtime meets the minimum version requirement.
 * Returns null if OK, or an error message string.
 */
export function checkRuntime(): string | null {
  if (typeof Bun === "undefined") {
    return "Gordon requires the Bun runtime. Install it from https://bun.sh";
  }

  const current = Bun.version;
  if (compareSemver(current, MIN_BUN_VERSION) < 0) {
    return `Gordon requires Bun >= ${MIN_BUN_VERSION} (you have ${current}). Run: bun upgrade`;
  }

  return null;
}

/**
 * Simple semver comparison. Returns -1, 0, or 1.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

export function printHelp(): void {
  console.log(`gordon v${VERSION} — AI-powered crypto trading CLI

USAGE
  gordon                    Launch interactive trading terminal
  gordon [flags]            Launch with options
  gordon daemon <action>    Manage local daemon (start|stop|status)
  gordon schedule <action>  Manage local scheduled tasks (add|remove|list)
  gordon doctor [--json]    Run configuration and provider diagnostics
  gordon configure [area]   Launch Gordon directly into a re-runnable setup flow
  gordon bootstrap [...]    Non-interactive setup for CI, cloud, and scripted machines
  gordon init [dir]         Scaffold a local agent project

FLAGS
  -h, --help       Show help and exit
  -v, --version    Show version and exit
  -d, --debug      Enable debug logging (verbose output)
      --json       Output system status as JSON and exit (or, with --headless,
                   emit the headless result as a single-line JSON report)
      --plain      Disable colors and formatting
      --no-color   Disable colors (also respects NO_COLOR env var)
      --cleanup    Remove stale sessions, caches, and temp files
      --uninstall  Remove all Gordon data (~/.gordon) and exit
      --upgrade    Upgrade Gordon using the current install channel and exit
      --headless   Run a single prompt with no TUI; print response to stdout and exit
      --quiet      Suppress event-log on stderr (use with --headless)

  Short flags can be grouped: -dv = --debug --version

INTERACTIVE COMMANDS
  Once in the terminal, use slash commands:
    /scan           Scan market for opportunities
    /trending       Show trending tokens
    /analyze BTC    Analyze a specific coin
    /portfolio      View your portfolio
    /preview-order  Preview a trade before execution
    /positions      View open positions
    /bugreport      Generate a bug report link
    /help           Browse workflows and commands

CONFIGURATION
  Config:     ${GORDON_DIR}/config.json
  Env:        ${GORDON_DIR}/.env
  Database:   ${GORDON_DIR}/gordon.db
  Override:   Set GORDON_HOME to use a custom directory
  Per-project: Place a .gordonrc file in your working directory

ENVIRONMENT VARIABLES
  GORDON_HOME                Override config directory path
  XDG_CONFIG_HOME            XDG base directory (uses $XDG_CONFIG_HOME/gordon/)
  GORDON_THEME               Theme: "dark" or "light"
  GORDON_PROVIDER            LLM provider
  GORDON_MODEL               LLM model
  NO_COLOR                   Disable colors when set
  LOG_LEVEL                  Set log level: debug, info, warn, error
  DO_NOT_TRACK               Disable telemetry (consoledonottrack.com)
  GORDON_TELEMETRY_DISABLED  Disable telemetry (Gordon-specific)
  GORDON_TELEMETRY_DEBUG     Print telemetry events to stderr (debug)

UPDATING
  gordon --upgrade
  Gordon checks for updates daily and notifies you on startup.

GETTING STARTED
  1. Run 'gordon' to launch the terminal
  2. Choose QuickStart or Advanced onboarding
  3. Use /scan to find trading opportunities

OPERATIONS
  gordon doctor
  gordon configure llm
  gordon configure exchange
  gordon bootstrap --profile quickstart --llm-provider openai --llm-key sk-...

SUPPORT
  GitHub:  https://github.com/general-liquidity/gordon
  Issues:  https://github.com/general-liquidity/gordon/issues`);
}

export function printVersion(): void {
  console.log(`gordon v${VERSION}`);
}

export async function printStatusJson(): Promise<void> {
  const { checkEnvStatus } = await import("./infra/storage/config/env.ts");
  const { loadConfig } = await import("./infra/storage/config/config.ts");

  try {
    const envStatus = await checkEnvStatus();
    const config = await loadConfig();
    const { getStatus: getTelemetryStatus } = await import("./infra/platform/telemetry/index.ts");

    const status = {
      version: VERSION,
      configDir: GORDON_DIR,
      configured: envStatus.hasLLMKey,
      onboardingComplete: config.onboardingComplete,
      permissionMode: config.permissionMode,
      exchanges: config.exchanges.map((e) => ({
        id: e.id,
        type: e.type,
        isDefault: e.isDefault,
        sandbox: e.sandbox ?? false,
      })),
      activeExchangeId: config.activeExchangeId || null,
      brokers: (config.brokers || []).map((b) => ({
        id: b.id,
        type: b.type,
        isDefault: b.isDefault,
        paper: b.paper,
      })),
      activeBrokerId: config.activeBrokerId || null,
      theme: process.env.GORDON_THEME || "dark",
      provider: config.modelConfig?.provider || process.env.GORDON_PROVIDER || "openai",
      model: config.modelConfig?.model || process.env.GORDON_MODEL || null,
      runtime: typeof Bun !== "undefined" ? `bun ${Bun.version}` : "unknown",
      telemetry: getTelemetryStatus(),
    };

    console.log(JSON.stringify(status, null, 2));
  } catch (error) {
    console.error(
      JSON.stringify({ error: "Failed to load configuration", details: String(error) }),
    );
    process.exit(1);
  }
}

/**
 * Run cleanup operations: remove stale sessions, temp files, old backups.
 */
export async function runCleanup(): Promise<void> {
  console.log("Cleaning up Gordon data...\n");

  let cleaned = 0;

  // Clean old chat sessions
  try {
    const { cleanupOldSessions } = await import("./infra/storage/entities/chat-history.ts");
    const result = await cleanupOldSessions({ keepDays: 30 });
    if (result.deleted > 0) {
      console.log(`  Removed ${result.deleted} chat sessions older than 30 days`);
      cleaned += result.deleted;
    }
  } catch {
    // Module may not be available
  }

  // Prune old backups
  try {
    const { pruneOldBackups } = await import("./infra/storage/backup.ts");
    const pruned = await pruneOldBackups();
    if (pruned > 0) {
      console.log(`  Pruned ${pruned} old database backups`);
      cleaned += pruned;
    }
  } catch {
    // Module may not be available
  }

  // Prune config backups
  try {
    const { pruneConfigBackups } = await import("./infra/storage/config/config-migration.ts");
    const pruned = await pruneConfigBackups(5);
    if (pruned > 0) {
      console.log(`  Pruned ${pruned} old config backups`);
      cleaned += pruned;
    }
  } catch {
    // Module may not be available
  }

  if (cleaned === 0) {
    console.log("  Nothing to clean up.");
  }

  console.log("\nDone.");
}

/**
 * Uninstall Gordon: remove ~/.gordon directory and all data.
 * Prompts for confirmation before proceeding.
 */
export async function runUninstall(): Promise<void> {
  const { existsSync } = await import("node:fs");

  if (!existsSync(GORDON_DIR)) {
    console.log("Nothing to remove — Gordon data directory does not exist.");
    return;
  }

  console.log(`This will permanently remove all Gordon data at:\n  ${GORDON_DIR}\n`);
  console.log("This includes: config, database, API keys, chat history, backups, strategies.\n");

  // Read confirmation from stdin
  process.stdout.write("Type 'yes' to confirm: ");

  const response = await new Promise<string>((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (chunk) => {
      data += chunk;
      resolve(data.trim());
    });
    // Timeout after 30 seconds
    setTimeout(() => resolve(""), 30_000);
  });

  if (response.toLowerCase() !== "yes") {
    console.log("\nCancelled. No data was removed.");
    return;
  }

  try {
    const { rm } = await import("node:fs/promises");
    await rm(GORDON_DIR, { recursive: true, force: true });
    console.log(`\nRemoved ${GORDON_DIR}`);
    console.log("To reinstall: npm install -g @general-liquidity/gordon");
    console.log(
      "If global npm permissions are blocked: npx @general-liquidity/gordon@latest install",
    );
  } catch (error) {
    console.error(`\nFailed to remove ${GORDON_DIR}:`, error);
    process.exit(1);
  }
}

export { VERSION, MIN_BUN_VERSION };
