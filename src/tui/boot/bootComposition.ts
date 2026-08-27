import * as fs from "node:fs";
import * as path from "node:path";
import {
  isOutboundFetchGuardInstalled,
  type OutboundFetchGuardStatus,
} from "../../infra/safety/outboundFetchGuard.ts";
import {
  isFilesystemWriteGuardInstalled,
  type FilesystemWriteGuardStatus,
} from "../../infra/safety/filesystemWriteGuardInstaller.ts";
import { listTrippedSwitches, type KillSwitchKey } from "../../infra/safety/killSwitches.ts";
import { isObserverRunning } from "../../infra/proactive/engine/observer.ts";
import { getProducerHealthTracker } from "../../infra/proactive/engine/producerHealth.ts";
import { getSuggestionStore } from "../../infra/proactive/storage/suggestionStore.ts";
import { getGordonDir } from "../../infra/storage/paths.ts";

const TEAL = "\x1b[38;2;52;238;176m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";
const RESET = "\x1b[0m";

const LABEL_WIDTH = 10;
const INDENT_WIDTH = 2;
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export const MODE_ANSI: Record<string, string> = {
  auto: "\x1b[31m",
  ask: TEAL,
  strict: "\x1b[32m",
  paper: "",
  observe: "\x1b[35m",
  plan: "\x1b[34m",
};

export interface BootStaticInfo {
  version: string;
  model: string;
  effort: string | null;
  permissionMode: string;
  threadDisplay: string;
  cwd: string;
  fetchGuard: OutboundFetchGuardStatus;
  fsGuard: FilesystemWriteGuardStatus;
  trippedSwitches: Array<{ key: KillSwitchKey; reason: string; trippedAt: number }>;
  radar: { running: boolean; producerCount: number; lastCardAgeMs: number | null };
}

export function visibleLength(value: string): number {
  return value.replace(ANSI_PATTERN, "").length;
}

function truncateAnsi(value: string, maxVisible: number): string {
  if (maxVisible <= 0) return "";
  if (visibleLength(value) <= maxVisible) return value;
  if (maxVisible === 1) return "…";

  let out = "";
  let visible = 0;
  for (let i = 0; i < value.length; ) {
    const rest = value.slice(i);
    const escapeSequence = rest.match(/^\x1b\[[0-9;]*m/);
    if (escapeSequence) {
      out += escapeSequence[0];
      i += escapeSequence[0].length;
      continue;
    }

    const [char] = Array.from(rest);
    if (!char) break;
    if (visible >= maxVisible - 1) break;
    out += char;
    visible += 1;
    i += char.length;
  }

  return `${out}…${RESET}`;
}

function truncateStart(value: string, maxVisible: number): string {
  if (maxVisible <= 0) return "";
  if (value.length <= maxVisible) return value;
  if (maxVisible === 1) return "…";
  return `…${value.slice(-(maxVisible - 1))}`;
}

function readJsonFile(pathname: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(pathname)) return null;
    const parsed = JSON.parse(fs.readFileSync(pathname, "utf-8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readBootConfig(): Pick<BootStaticInfo, "model" | "permissionMode" | "threadDisplay"> {
  try {
    const gordonDir = getGordonDir();
    let permissionMode = "ask";
    let model = process.env.GORDON_MODEL ?? "";
    let threadDisplay = "new session";

    const config = readJsonFile(path.join(gordonDir, "config.json"));
    if (config) {
      if (typeof config.permissionMode === "string") permissionMode = config.permissionMode;
      const modelConfig = config.modelConfig as Record<string, unknown> | undefined;
      if (!model && typeof modelConfig?.model === "string") model = modelConfig.model;
    }

    if (!model) {
      try {
        const envPath = path.join(gordonDir, ".env");
        if (fs.existsSync(envPath)) {
          const match = fs.readFileSync(envPath, "utf-8").match(/^GORDON_MODEL=(.+)$/m);
          if (match?.[1]) model = match[1].trim().replace(/^["']|["']$/g, "");
        }
      } catch {
        // Ignore malformed or unreadable .env.
      }
    }

    const session = readJsonFile(path.join(gordonDir, "session.json"));
    const threadId = typeof session?.threadId === "string" ? session.threadId : null;
    if (threadId) threadDisplay = threadId.slice(0, 24);

    return { model: model || "auto", permissionMode, threadDisplay };
  } catch {
    return {
      model: process.env.GORDON_MODEL ?? "auto",
      permissionMode: "ask",
      threadDisplay: "new session",
    };
  }
}

function safeRead<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function defaultFetchGuard(): OutboundFetchGuardStatus {
  return {
    installed: false,
    enabled: false,
    mode: "warn",
    warnViolations: 0,
    recentViolations: [],
  };
}

function defaultFsGuard(): FilesystemWriteGuardStatus {
  return {
    installed: false,
    enabled: false,
    mode: "warn",
    warnViolations: 0,
    recentViolations: [],
  };
}

function collectRadarSnapshot(): BootStaticInfo["radar"] {
  try {
    const running = isObserverRunning();
    const producerCount = getProducerHealthTracker().report().producers.length;
    const lastCard = getSuggestionStore().getRecent(1)[0];
    const lastCardAt = lastCard?.createdAt ? Date.parse(lastCard.createdAt) : Number.NaN;
    return {
      running,
      producerCount,
      lastCardAgeMs: Number.isFinite(lastCardAt) ? Math.max(0, Date.now() - lastCardAt) : null,
    };
  } catch {
    return { running: false, producerCount: 0, lastCardAgeMs: null };
  }
}

/** Sync reads only: config/session files + guard/kill-switch/radar accessors. Never throws. */
export function collectBootStaticInfo(): BootStaticInfo {
  const rawVersion = process.env.npm_package_version ?? process.env.GORDON_VERSION ?? "0.9";
  const config = readBootConfig();

  return {
    version: rawVersion.split("-")[0]!,
    model: config.model,
    effort: process.env.GORDON_EFFORT ?? null,
    permissionMode: config.permissionMode,
    threadDisplay: config.threadDisplay,
    cwd: process.cwd(),
    fetchGuard: safeRead(isOutboundFetchGuardInstalled, defaultFetchGuard()),
    fsGuard: safeRead(isFilesystemWriteGuardInstalled, defaultFsGuard()),
    trippedSwitches: safeRead(listTrippedSwitches, []),
    radar: collectRadarSnapshot(),
  };
}

export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function renderGuard(
  name: string,
  status: OutboundFetchGuardStatus | FilesystemWriteGuardStatus,
): string {
  if (status.enabled && !status.installed) return `${name} ${RED}${BOLD}✗ NOT INSTALLED${RESET}`;
  if (!status.enabled) return `${name} ${YELLOW}✗ off${RESET}`;
  return `${name} ${TEAL}✓${RESET} ${DIM}${status.mode}${RESET}`;
}

function keyToString(key: KillSwitchKey): string {
  return key.id ? `${key.scope}:${key.id}` : key.scope;
}

function renderSwitches(info: BootStaticInfo, maxVisible: number): string {
  const switches = info.trippedSwitches;
  if (switches.length === 0) return `${DIM}none tripped${RESET}`;

  const firm = switches.find((entry) => entry.key.scope === "firm");
  if (firm) {
    const prefix = "HALTED: firm — ";
    const reasonMax = Math.max(0, maxVisible - prefix.length);
    return `${RED}${BOLD}${prefix}${truncateAnsi(firm.reason, reasonMax)}${RESET}`;
  }

  return `${RED}${BOLD}tripped: ${switches.map((entry) => keyToString(entry.key)).join(", ")}${RESET}`;
}

function renderRadar(info: BootStaticInfo): string {
  const { radar } = info;
  if (!radar.running) {
    return `${DIM}off — set GORDON_PROACTIVE_AUTO_START=1 or /radar start${RESET}`;
  }
  if (radar.lastCardAgeMs === null) {
    return `${radar.producerCount} producers · warming up`;
  }
  return `${radar.producerCount} producers · last card ${formatAge(radar.lastCardAgeMs)} ago`;
}

function renderRow(
  label: string,
  value: string,
  budget: number,
  columns: number,
  hint?: string,
): string {
  const labelCell = `  ${DIM}${label.padEnd(LABEL_WIDTH)}${RESET}`;
  const valueBudget = budget - INDENT_WIDTH - LABEL_WIDTH;
  if (valueBudget <= 0) return truncateAnsi(labelCell, budget);

  const hintSuffix = hint && columns >= 70 ? `  ${DIM}${hint}${RESET}` : "";
  const reservedForHint = visibleLength(hintSuffix);
  const valueMax = Math.max(0, valueBudget - reservedForHint);
  const shownValue = truncateAnsi(value, valueMax);
  const maybeHint =
    hintSuffix && visibleLength(labelCell + shownValue + hintSuffix) <= budget ? hintSuffix : "";
  const row = `${labelCell}${shownValue}${maybeHint}`;
  return visibleLength(row) <= budget ? row : truncateAnsi(row, budget);
}

/**
 * Wrap rows in a titled box (`┌─ title ─…┐`). Width adapts to the widest row,
 * capped at the terminal — the printBootCard pattern. Falls back to unboxed
 * rows when the terminal can't even fit the title in the top border.
 */
function boxSection(title: string, rows: string[], maxTotal: number): string[] {
  const innerMax = maxTotal - 2;
  const titleMin = title.length + 3;
  if (innerMax < titleMin) return rows.map((row) => truncateAnsi(row, maxTotal));

  const inner = Math.min(innerMax, Math.max(titleMin, ...rows.map(visibleLength)));
  const fill = "─".repeat(Math.max(0, inner - title.length - 3));
  const body = rows.map((row) => {
    const shown = truncateAnsi(row, inner);
    const pad = " ".repeat(Math.max(0, inner - visibleLength(shown)));
    return `${GRAY}│${RESET}${shown}${pad}${GRAY}│${RESET}`;
  });
  return [
    `${GRAY}┌─ ${RESET}${DIM}${title}${RESET}${GRAY} ${fill}┐${RESET}`,
    ...body,
    `${GRAY}└${"─".repeat(inner)}┘${RESET}`,
  ];
}

/** Raw-ANSI lines for the boxed `session` section (banner NOT included — caller composes). */
export function renderBootStaticRows(info: BootStaticInfo, columns: number): string[] {
  if (columns <= 0) return [];

  // -1 terminal safety margin, -2 box borders: rows are built to the inner budget.
  const maxTotal = Math.max(0, columns - 1);
  const rowBudget = Math.max(0, maxTotal - 2);
  const modelValue = `${info.model}${info.effort ? ` ${info.effort}` : ""}`;
  const modeColor = MODE_ANSI[info.permissionMode] ?? TEAL;
  const isPaper = info.permissionMode === "paper";
  const modeValue = `${modeColor}${info.permissionMode}${RESET}${isPaper ? ` ${BOLD}${YELLOW}[PAPER]${RESET}` : ""}`;
  const bodyBudget = Math.max(0, rowBudget - INDENT_WIDTH - LABEL_WIDTH);
  const cwdValue = truncateStart(info.cwd, bodyBudget);
  const guardValue = [renderGuard("fetch", info.fetchGuard), renderGuard("fs", info.fsGuard)].join(
    ` ${DIM}·${RESET} `,
  );

  const rows = [
    renderRow("model", modelValue, rowBudget, columns, "/model to change"),
    renderRow("mode", modeValue, rowBudget, columns, isPaper ? "/live to exit" : "/auto to change"),
    renderRow("thread", info.threadDisplay, rowBudget, columns),
    renderRow("cwd", cwdValue, rowBudget, columns),
    renderRow("guards", guardValue, rowBudget, columns),
    renderRow("switches", renderSwitches(info, bodyBudget), rowBudget, columns),
    renderRow("radar", renderRadar(info), rowBudget, columns),
  ];
  return boxSection("session", rows, maxTotal);
}
