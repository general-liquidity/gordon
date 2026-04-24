import React from "react";
import { render } from "ink";
import { App } from "./App.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export async function startGordonTUI(): Promise<void> {
  // Take over the terminal: clear screen so Gordon fills the viewport cleanly,
  // then print the full boot card once. Ink renders its live frame below those
  // lines. As the conversation grows the boot card naturally scrolls into
  // terminal history — no React lifecycle involved, no double-renders.
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[2J\x1b[H");
    printBootCard();
  }

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

// ============================================================================
// Boot card — printed once to stdout before Ink starts
// ============================================================================

/** Read config + env + session synchronously to get real values before Ink starts */
function readBootConfig(): { model: string; permissionMode: string; sessionDisplay: string } {
  try {
    const gordonDir =
      process.env.GORDON_HOME ??
      (process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, "gordon") : path.join(os.homedir(), ".gordon"));

    let permissionMode = "ask";
    let model = process.env.GORDON_MODEL ?? "";
    let sessionDisplay = "new session";

    // config.json → permissionMode + model
    const configPath = path.join(gordonDir, "config.json");
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
        if (typeof config.permissionMode === "string") permissionMode = config.permissionMode;
        const mc = config.modelConfig as Record<string, unknown> | undefined;
        if (!model && typeof mc?.model === "string") model = mc.model;
      } catch { /* ignore */ }
    }

    // .gordon/.env → GORDON_MODEL fallback
    if (!model) {
      const envPath = path.join(gordonDir, ".env");
      if (fs.existsSync(envPath)) {
        try {
          const envContent = fs.readFileSync(envPath, "utf-8");
          const match = envContent.match(/^GORDON_MODEL=(.+)$/m);
          if (match?.[1]) model = match[1].trim().replace(/^["']|["']$/g, "");
        } catch { /* ignore */ }
      }
    }

    // session.json → last threadId
    const sessionPath = path.join(gordonDir, "session.json");
    if (fs.existsSync(sessionPath)) {
      try {
        const session = JSON.parse(fs.readFileSync(sessionPath, "utf-8")) as Record<string, unknown>;
        const tid = typeof session.threadId === "string" ? session.threadId : null;
        if (tid) sessionDisplay = tid.slice(0, 24);
      } catch { /* ignore */ }
    }

    return { model: model || "auto", permissionMode, sessionDisplay };
  } catch {
    return { model: process.env.GORDON_MODEL ?? "auto", permissionMode: "ask", sessionDisplay: "new session" };
  }
}

/**
 * Tip scheduler — picks the tip with the longest time since last shown.
 * Reads/writes ~/.gordon/tipHistory.json synchronously. Mirrors Claude Code's
 * tipScheduler.selectTipWithLongestTimeSinceShown() pattern (without the
 * context filters — every tip is eligible for now).
 */
function pickTip(tips: readonly string[]): string {
  const fallback = () => tips[Math.floor(Math.random() * tips.length)]!;
  try {
    const gordonDir =
      process.env.GORDON_HOME ??
      (process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, "gordon") : path.join(os.homedir(), ".gordon"));
    const historyPath = path.join(gordonDir, "tipHistory.json");

    let lastShown: Record<string, number> = {};
    let sessionCount = 0;
    if (fs.existsSync(historyPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(historyPath, "utf-8")) as {
          lastShown?: Record<string, number>;
          sessionCount?: number;
        };
        lastShown = parsed.lastShown ?? {};
        sessionCount = parsed.sessionCount ?? 0;
      } catch { /* corrupt file → start fresh */ }
    }
    sessionCount += 1;

    // Pick the tip with the oldest lastShown (never-shown tips win with 0)
    let bestIdx = 0;
    let bestAge = -1;
    for (let i = 0; i < tips.length; i++) {
      const seen = lastShown[String(i)] ?? 0; // 0 = never shown
      const age = sessionCount - seen;
      if (age > bestAge) {
        bestAge = age;
        bestIdx = i;
      }
    }

    // Record this session and persist
    lastShown[String(bestIdx)] = sessionCount;
    try {
      if (!fs.existsSync(gordonDir)) fs.mkdirSync(gordonDir, { recursive: true });
      fs.writeFileSync(historyPath, JSON.stringify({ lastShown, sessionCount }, null, 2));
    } catch { /* read-only fs → tip still shown, just not tracked */ }

    return tips[bestIdx]!;
  } catch {
    return fallback();
  }
}

const TIPS = [
  'Type /scan to discover opportunities across all connected venues.',
  'Use /morning-brief for a market overview before your first trade.',
  'Try /analyze BTC to get a deep-dive on any asset.',
  '/trending shows what\'s pumping right now across crypto markets.',
  '/portfolio gives you a live snapshot of your positions and P&L.',
  '/preview-order lets you see the exact order before it executes.',
  '/positions shows all open positions with real-time P&L.',
  'Switch to paper mode with /paper — trade risk-free against live prices.',
  'Use /auto to let Gordon monitor and trade autonomously.',
  '/backtest runs any strategy against historical data.',
  '/model lets you switch the underlying AI mid-session.',
  'Press Ctrl+P to open the command palette from anywhere.',
  'Press ? to browse all available slash commands.',
  '/history shows your full trade and decision log.',
  'Set a stop-loss in plain English — Gordon understands natural language orders.',
  'Gordon remembers context across the session — no need to repeat yourself.',
  '/export saves a full session transcript for your records.',
  'Use /strict mode to require confirmation before every action.',
  'Connect multiple exchanges with /configure exchange.',
  '/doctor checks your configuration and connectivity in one go.',
];

function printBootCard(): void {
  const rawVersion = process.env.npm_package_version ?? process.env.GORDON_VERSION ?? "0.9";
  // Strip pre-release suffix (e.g. "0.9.0-friends.9" → "0.9.0")
  const version = rawVersion.split("-")[0]!;

  const { model, permissionMode: mode, sessionDisplay } = readBootConfig();
  const isPaper = mode === "paper";

  // ANSI helpers
  const T = "\x1b[38;2;52;238;176m"; // teal  (matches GordonHeader rgb(52,238,176))
  const B = "\x1b[1m";               // bold
  const D = "\x1b[2m";               // dim
  const Y = "\x1b[33m";              // yellow
  const G = "\x1b[90m";              // gray
  const R = "\x1b[0m";               // reset

  // Mode color — mirrors GordonHeader MODE_COLOR map (paper intentionally plain)
  const MODE_ANSI: Record<string, string> = {
    auto:    "\x1b[31m",
    ask:     T,
    strict:  "\x1b[32m",
    paper:   "",
    observe: "\x1b[35m",
    plan:    "\x1b[34m",
  };
  const modeColor = MODE_ANSI[mode] ?? T;

  const effort = process.env.GORDON_EFFORT ?? "";
  const effortSuffix = effort ? ` ${effort}` : "";
  const modeHint = isPaper ? "/live to exit  " : "/auto to change";
  const cwd = process.cwd();

  // INNER adapts to the widest row's natural content, capped at terminal width
  const termWidth = (process.stdout.columns ?? 120) - 2; // -2 for border chars
  const INNER = Math.min(
    termWidth,
    Math.max(
      `  ≫  Gordon CLI (v${version})`.length,
      31, // "     The Frontier Trading Agent"
      28, // "     General Liquidity, Inc."
      14 + model.length + effortSuffix.length + 19, // model + hint
      14 + mode.length + 6 + modeHint.length,        // mode + hint
      14 + sessionDisplay.length,                     // session
      14 + cwd.length,                                // directory
    ) + 2, // 2 chars right padding
  );

  // Strip ANSI escapes to measure visible length
  const vlen = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

  // Pad content to INNER and wrap in border chars
  const row = (content: string) => {
    const pad = " ".repeat(Math.max(0, INNER - vlen(content)));
    return `${G}│${R}${content}${pad}${G}│${R}`;
  };

  // Safety truncation only if terminal is narrower than the content
  const modelContent = model + effortSuffix;
  const modelAvail = INNER - 14 - 19;
  const modelDisplay = modelContent.length > modelAvail
    ? modelContent.slice(0, modelAvail - 1) + "…"
    : modelContent;

  const dirAvail = INNER - 14;
  const dirDisplay = cwd.length > dirAvail ? "…" + cwd.slice(-(dirAvail - 1)) : cwd;

  const tip = pickTip(TIPS);

  const lines = [
    `${G}╭${"─".repeat(INNER)}╮${R}`,
    row(`  ${T}${B}≫${R}  Gordon CLI (v${version})`),
    row(`     The Frontier Trading Agent`),
    row(`     General Liquidity, Inc.`),
    row(``),
    row(`   ${D}model:     ${R}${modelDisplay}${D}   /model to change${R}`),
    row(`   ${D}mode:      ${R}${modeColor}${mode}${R}${D}      ${modeHint}${R}`),
    row(`   ${D}session:   ${R}${sessionDisplay}`),
    row(`   ${D}directory: ${R}${dirDisplay}`),
    `${G}╰${"─".repeat(INNER)}╯${R}`,
    ``,
    ` ${D}Tip: ${tip}${R}`,
    ``,
  ];

  process.stdout.write(lines.join("\n") + "\n");
}
