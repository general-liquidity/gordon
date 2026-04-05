/**
 * GORDON.md: Hierarchical Project Personality
 *
 * Markdown-prose config for per-user / per-project preferences that get
 * loaded and merged at session start, then injected into the agent prompt.
 * Patterned after Claude Code's CLAUDE.md chain.
 *
 * Load order (later overrides earlier):
 *   1. ~/.gordon/GORDON.md      (user global)
 *   2. <cwd>/.gordon/GORDON.md  (project)
 *   3. <cwd>/GORDON.md          (project root, fallback)
 *
 * Typical contents:
 *   - Trader profile ("swing trader, no leverage, US equities + crypto")
 *   - Risk rules ("2% max per trade, never short biotechs")
 *   - Venue preferences ("route stocks via Schwab, crypto via Coinbase")
 *   - Naming conventions / abbreviations
 *   - Custom market-hours overrides
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GORDON_DIR } from "../storage/paths.ts";

export const USER_GORDON_MD = join(GORDON_DIR, "GORDON.md");

export const DEFAULT_GORDON_MD = `# Gordon Personality

Gordon loads this file at session start and injects its contents into the
agent prompt. Edit freely to shape Gordon's behavior.

## Trader profile

(describe yourself: swing / day / position; time horizon; capital tier)

## Risk rules

- Per-trade cap: 2% of portfolio
- Daily loss cap: 4%
- Max drawdown: 15%
- Correlation threshold: 0.7 (require approval if new position exceeds)

## Venue preferences

(which broker/exchange for which instruments; paper vs live)

## Excluded instruments

- (list symbols or sectors you never trade)

## Strategy preferences

- (e.g., "always check macro regime before opening positions")
`;

export interface GordonMdFile {
  path: string;
  exists: boolean;
  scope: "user" | "project" | "project-root";
  content: string;
}

export interface LoadedGordonMd {
  /** Merged content of all discovered files in load order. */
  merged: string;
  /** Individual files that were loaded. */
  files: GordonMdFile[];
  /** Flag that NO file was found. */
  empty: boolean;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function tryLoad(path: string, scope: GordonMdFile["scope"]): GordonMdFile {
  if (!existsSync(path)) return { path, exists: false, scope, content: "" };
  try {
    const content = readFileSync(path, "utf-8").trim();
    return { path, exists: true, scope, content };
  } catch {
    return { path, exists: false, scope, content: "" };
  }
}

/**
 * Load the GORDON.md chain from all standard locations.
 * Returns merged content with section headers identifying each source.
 */
export function loadGordonMd(cwd: string = process.cwd()): LoadedGordonMd {
  const files: GordonMdFile[] = [
    tryLoad(USER_GORDON_MD, "user"),
    tryLoad(join(cwd, ".gordon", "GORDON.md"), "project"),
    tryLoad(join(cwd, "GORDON.md"), "project-root"),
  ];

  const present = files.filter((f) => f.exists && f.content.length > 0);
  if (present.length === 0) {
    return { merged: "", files, empty: true };
  }

  const sections = present.map((f) => {
    const header = `# === ${f.scope.toUpperCase()} (${f.path}) ===`;
    return `${header}\n\n${f.content}`;
  });

  return {
    merged: sections.join("\n\n---\n\n"),
    files,
    empty: false,
  };
}

/** Initialize the user-global GORDON.md with the default template. */
export function initializeUserGordonMd(): boolean {
  if (existsSync(USER_GORDON_MD)) return false;
  ensureDir(GORDON_DIR);
  writeFileSync(USER_GORDON_MD, DEFAULT_GORDON_MD, { encoding: "utf-8", mode: 0o600 });
  return true;
}

/** Write a GORDON.md file at the specified path. */
export function writeGordonMd(path: string, content: string): void {
  const dir = path.substring(0, path.lastIndexOf("/"));
  ensureDir(dir);
  writeFileSync(path, content, { encoding: "utf-8", mode: 0o600 });
}

/**
 * Build the agent-prompt injection block from the merged GORDON.md content.
 * Returns empty string if no files are present (caller can skip injection).
 */
export function buildAgentPromptBlock(loaded: LoadedGordonMd): string {
  if (loaded.empty) return "";
  return `[GORDON_PERSONALITY]\nThe user has configured the following preferences. Honor them throughout the session:\n\n${loaded.merged}`;
}
