import type { ThreadInfo } from "../agents/memory/threadManager.ts";
import type { ActionLogEntry } from "./types.ts";

function shorten(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatActionLogEntries(entries: ActionLogEntry[], title: string = "Action log"): string {
  if (entries.length === 0) {
    return `**${title}**\n\nNo entries found.`;
  }

  const lines = [
    `**${title}**\n`,
    "| ID | Time | Type | Title |",
    "|----|------|------|-------|",
  ];

  for (const entry of entries) {
    const titleText = entry.label ? `${entry.title} (${entry.label})` : entry.title;
    lines.push(
      `| \`${entry.id.slice(0, 8)}\` | ${formatTime(entry.createdAt)} | \`${entry.entryType}\` | ${shorten(titleText, 72)} |`,
    );
  }

  return lines.join("\n");
}

export function buildThreadSummaryReport(thread: ThreadInfo, entries: ActionLogEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.entryType, (counts.get(entry.entryType) ?? 0) + 1);
  }

  const countLines = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([type, count]) => `- \`${type}\`: ${count}`);

  const highlightLines = entries
    .slice(0, 8)
    .map((entry) => `- ${entry.title}${entry.content ? `: ${shorten(entry.content, 96)}` : ""}`);

  return [
    `Thread summary for "${thread.label}"`,
    "",
    `Thread ID: \`${thread.threadId}\``,
    `Messages: ${thread.messageCount}`,
    `Created: ${formatTime(thread.createdAt)}`,
    `Last active: ${formatTime(thread.lastActiveAt)}`,
    `Branch: ${thread.clonedFrom ? `yes (from \`${thread.clonedFrom.slice(0, 16)}...\`)` : "no"}`,
    "",
    "Top activity types:",
    ...(countLines.length > 0 ? countLines : ["- No typed activity recorded yet."]),
    "",
    "Recent highlights:",
    ...(highlightLines.length > 0 ? highlightLines : ["- No recent highlights available."]),
  ].join("\n");
}

export function buildCompactionSummary(entries: ActionLogEntry[], note?: string): string {
  const lines = ["Thread compaction summary", ""];

  if (note) {
    lines.push(`Operator note: ${note}`, "");
  }

  lines.push(`Entries summarized: ${entries.length}`);

  const highlights = entries.slice(0, 12).map((entry) => {
    const detail = entry.content || entry.title;
    return `- [${entry.entryType}] ${shorten(detail, 110)}`;
  });

  lines.push("", "Condensed history:");
  lines.push(...(highlights.length > 0 ? highlights : ["- No entries available."]));

  return lines.join("\n");
}
