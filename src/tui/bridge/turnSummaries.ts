// Session-scoped turn-summary store — the TUI wiring turnSummary.ts was
// built for. streamResponse records each completed turn; /turns renders the
// "what happened recently" navigation view from the ring buffer instead of
// paging the whole transcript.

import {
  buildTurnSummary,
  TurnSummaryRingBuffer,
  type TurnSummary,
} from "../../infra/domain/memory/turnSummary.ts";

const buffer = new TurnSummaryRingBuffer(50);

export function recordTurn(userText: string, assistantText: string): void {
  if (!userText.trim() || !assistantText.trim()) return;
  buffer.push(
    buildTurnSummary(
      { role: "user", content: userText },
      { role: "assistant", content: assistantText },
    ),
  );
}

export function getTurnSummaries(limit?: number): TurnSummary[] {
  return buffer.list(limit);
}

export function resetTurnSummaries(): void {
  buffer.clear();
}

function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatLine(t: TurnSummary, index: number): string {
  const tools =
    t.toolCallCount > 0
      ? `${t.toolCallCount} tool${t.toolCallCount === 1 ? "" : "s"}${t.dominantTool ? ` (${t.dominantTool})` : ""}`
      : "no tools";
  return [
    `${String(index + 1).padStart(2)}. ${clock(t.completedAt)} [${t.intent}] ${tools} — "${t.userPrompt}"`,
    `      ⌐ ${t.assistantHead}`,
  ].join("\n");
}

/**
 * Render the /turns view. With args, runs a substring search over prompts
 * and replies; without, lists recent turns newest-first.
 */
export function formatTurnsView(args: string, limit = 15): string {
  const needle = args.trim();
  if (needle) {
    const hit = buffer.find(needle);
    if (!hit) return `No turn matching "${needle}" in the last ${buffer.size()} turns.`;
    return `Most recent turn matching "${needle}":\n${formatLine(hit, 0)}`;
  }
  const turns = buffer.list(limit);
  if (turns.length === 0) {
    return "No completed turns yet this session. Turns appear here after each agent response.";
  }
  const header = `Recent turns (newest first, ${turns.length} of ${buffer.size()}):`;
  return [header, ...turns.map(formatLine)].join("\n");
}
