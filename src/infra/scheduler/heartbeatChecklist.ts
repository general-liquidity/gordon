/**
 * HEARTBEAT.md: Declarative Monitoring Checklist
 *
 * A file-based "set and forget" monitoring pattern. The user writes a
 * markdown checklist at ~/.gordon/HEARTBEAT.md like:
 *
 *     - Check if SPY breaks its 50-day moving average
 *     - Alert if VIX > 25
 *     - Watch NVDA for moves greater than 2%
 *     - Flag earnings scheduled within the next 48 hours
 *
 * The scheduler runs periodically (respecting ActiveHours) and sends the
 * checklist as context to Gordon's agent, which fans out to the relevant
 * tools and surfaces anything that matches. Pure "vibe trading" UX: users
 * describe WHAT to watch in natural language, not HOW.
 *
 * Storage: ~/.gordon/HEARTBEAT.md (single file, user-editable).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GORDON_DIR } from "../storage/paths.ts";

export const HEARTBEAT_MD_PATH = join(GORDON_DIR, "HEARTBEAT.md");

export const DEFAULT_HEARTBEAT_TEMPLATE = `# Gordon Heartbeat

Items below run every heartbeat cycle. Gordon interprets each line and fans
out to the appropriate tools (prices, news, indicators, alerts).

## Items

- Major index moves (SPY, QQQ, DIA moves > 1.5%)
- VIX level check (alert if above 25)
- Breaking financial news (last hour)
- Any alerts triggered on watchlist tickers

## Notes

- Use checklist format (\`- item\`) for each monitored signal.
- Comment lines (\`#\`) are ignored.
- Remove this template and write your own monitoring preferences.
`;

export interface HeartbeatChecklist {
  /** Raw markdown contents. */
  raw: string;
  /** Extracted checklist items (lines starting with "- "). */
  items: string[];
  /** Whether the file exists on disk. */
  exists: boolean;
  /** Path on disk. */
  path: string;
}

function ensureGordonDir(): void {
  if (!existsSync(GORDON_DIR)) mkdirSync(GORDON_DIR, { recursive: true });
}

/** Parse HEARTBEAT.md into structured items. */
export function parseHeartbeat(content: string): string[] {
  const items: string[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    // Match "- item", "* item", "+ item"
    const m = line.match(/^[-*+]\s+(.+)$/);
    if (m) items.push(m[1]!.trim());
  }
  return items;
}

/** Read the current heartbeat checklist. */
export function readHeartbeat(): HeartbeatChecklist {
  if (!existsSync(HEARTBEAT_MD_PATH)) {
    return { raw: "", items: [], exists: false, path: HEARTBEAT_MD_PATH };
  }
  const raw = readFileSync(HEARTBEAT_MD_PATH, "utf-8");
  return { raw, items: parseHeartbeat(raw), exists: true, path: HEARTBEAT_MD_PATH };
}

/** Overwrite the heartbeat checklist. Creates file if missing. */
export function writeHeartbeat(content: string): HeartbeatChecklist {
  ensureGordonDir();
  writeFileSync(HEARTBEAT_MD_PATH, content, { encoding: "utf-8", mode: 0o600 });
  return readHeartbeat();
}

/** Create the default template if no file exists. */
export function initializeHeartbeatIfMissing(): boolean {
  if (existsSync(HEARTBEAT_MD_PATH)) return false;
  writeHeartbeat(DEFAULT_HEARTBEAT_TEMPLATE);
  return true;
}

/** Add a new checklist item. */
export function addHeartbeatItem(item: string): HeartbeatChecklist {
  const cur = readHeartbeat();
  const lines = cur.exists ? cur.raw.split(/\r?\n/) : DEFAULT_HEARTBEAT_TEMPLATE.split(/\r?\n/);
  // Find the "## Items" section header and append after the last "- " line.
  let insertIdx = -1;
  let inItems = false;
  let lastItemIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (/^##\s+Items/i.test(line)) {
      inItems = true;
      continue;
    }
    if (inItems && /^##/.test(line)) break;
    if (inItems && /^[-*+]\s+/.test(line)) lastItemIdx = i;
  }
  insertIdx = lastItemIdx >= 0 ? lastItemIdx + 1 : lines.length;
  lines.splice(insertIdx, 0, `- ${item}`);
  return writeHeartbeat(lines.join("\n"));
}

/** Remove a checklist item by substring match (case-insensitive). */
export function removeHeartbeatItem(substring: string): HeartbeatChecklist {
  const cur = readHeartbeat();
  if (!cur.exists) return cur;
  const needle = substring.toLowerCase();
  const lines = cur.raw.split(/\r?\n/).filter((line) => {
    const m = line.trim().match(/^[-*+]\s+(.+)$/);
    if (!m) return true;
    return !m[1]!.toLowerCase().includes(needle);
  });
  return writeHeartbeat(lines.join("\n"));
}

/**
 * Build the agent prompt payload from the current heartbeat checklist.
 * Returns null if the file is empty (no items) — caller should skip the cycle.
 */
export function buildHeartbeatQuery(): string | null {
  const checklist = readHeartbeat();
  if (!checklist.exists || checklist.items.length === 0) return null;

  const bullets = checklist.items.map((item) => `  - ${item}`).join("\n");
  return (
    `You are running a scheduled heartbeat check. Work through each item ` +
    `below, use the relevant tools to evaluate, and respond ONLY with items ` +
    `that merit user attention (alerts, triggers, notable moves). Skip items ` +
    `where nothing noteworthy happened. Be concise.\n\n` +
    `Heartbeat checklist:\n${bullets}\n\n` +
    `If nothing triggered across all items, respond with a single line: ` +
    `"Heartbeat quiet — nothing to report."`
  );
}
