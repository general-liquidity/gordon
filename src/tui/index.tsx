import React from "react";
import { render } from "ink";
import { App } from "./App.js";

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

function printBootCard(): void {
  const version = process.env.npm_package_version ?? process.env.GORDON_VERSION ?? "0.9";
  const model = process.env.GORDON_MODEL ?? "auto";
  const mode = process.env.GORDON_PERMISSION_MODE ?? "ask";
  const isPaper = mode === "paper";

  // ANSI helpers
  const T = "\x1b[38;2;52;238;176m"; // teal
  const B = "\x1b[1m";               // bold
  const D = "\x1b[2m";               // dim
  const Y = "\x1b[33m";              // yellow
  const G = "\x1b[90m";              // gray
  const R = "\x1b[0m";               // reset

  // Inner visible width (GordonHeader: width=56, 2 border chars → inner=54)
  const INNER = 54;

  // Strip ANSI escapes to measure visible length
  const vlen = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

  // Pad content to INNER width and wrap in gray border chars
  const row = (content: string) => {
    const pad = " ".repeat(Math.max(0, INNER - vlen(content)));
    return `${G}│${R}${content}${pad}${G}│${R}`;
  };

  // Truncate model name to avoid overflow
  const modelShort = model.length > 34 ? model.slice(0, 32) + "…" : model;
  const paperTag = isPaper ? `  ${Y}${B}[PAPER]${R}` : "";
  const modeHint = isPaper ? "/live to exit  " : "/auto to change";

  const lines = [
    `${G}╭${"─".repeat(INNER)}╮${R}`,
    row(`  ${T}${B}≫${R}  Gordon CLI (v${version})${paperTag}`),
    row(`     The Frontier Trading Agent`),
    row(`     General Liquidity, Inc.`),
    row(``),
    row(`   ${D}model:    ${R}${modelShort}${D}   /model to change${R}`),
    row(`   ${D}mode:     ${R}${mode}${D}      ${modeHint}${R}`),
    row(`   ${D}session:  ${R}initializing...`),
    row(`   ${D}tools:    ${R}loading...`),
    `${G}╰${"─".repeat(INNER)}╯${R}`,
    ``,
    ` ${D}Tip: Type /scan to discover opportunities, or describe what you want to trade.${R}`,
    ``,
  ];

  process.stdout.write(lines.join("\n") + "\n");
}
