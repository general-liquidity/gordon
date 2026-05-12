import {
  formatPromptContextReport,
  getLatestPromptContextReport,
} from "../../infra/agents/context/contextBudget.ts";
import { getEventBus, type EventData } from "../../events/index.ts";

export interface ContextCommandResult {
  success: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Last compaction details cache (populated by memory:compacted_details event)
// ---------------------------------------------------------------------------

type CompactedDetailsSnapshot = Omit<EventData<"memory:compacted_details">, "timestamp" | "type" | "id">;

let _lastCompactionDetails: CompactedDetailsSnapshot | null = null;
let _lastCompactionAt: number | null = null;
let _subscribed = false;

function subscribeIfNeeded(): void {
  if (_subscribed) return;
  getEventBus().on("memory:compacted_details", (event) => {
    _lastCompactionDetails = {
      stage: event.stage,
      iterative: event.iterative,
      messagesFolded: event.messagesFolded,
      symbols: event.symbols,
      venues: event.venues,
      strategies: event.strategies,
      indicators: event.indicators,
      chartPatterns: event.chartPatterns,
      timeframes: event.timeframes,
      researchArtifacts: event.researchArtifacts,
      mandates: event.mandates,
      approvals: event.approvals,
    };
    _lastCompactionAt = Date.now();
  });
  _subscribed = true;
}

export function getLastCompactionDetails(): CompactedDetailsSnapshot | null {
  subscribeIfNeeded();
  return _lastCompactionDetails;
}

function formatCompactionDetails(details: CompactedDetailsSnapshot, at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60_000));
  const ago = mins === 0 ? "just now" : `${mins}m ago`;
  const line = (label: string, items: string[]): string | null =>
    items.length > 0 ? `  ${label.padEnd(12)} ${items.slice(0, 8).join(", ")}${items.length > 8 ? ` (+${items.length - 8})` : ""}` : null;

  const lines: (string | null)[] = [
    "",
    `Last compaction (${ago}, stage=${details.stage}, folded=${details.messagesFolded}${details.iterative ? ", iterative" : ""}):`,
    line("symbols", details.symbols),
    line("venues", details.venues),
    line("strategies", details.strategies),
    line("indicators", details.indicators),
    line("patterns", details.chartPatterns),
    line("timeframes", details.timeframes),
    line("research", details.researchArtifacts),
    line("mandates", details.mandates),
    line("approvals", details.approvals),
  ];

  const body = lines.filter((l) => l !== null).join("\n");
  return body.length > 2 ? body : "";
}

export async function handleContextCommand(args: string, currentThreadId?: string): Promise<ContextCommandResult> {
  subscribeIfNeeded();
  const threadId = args.trim() || currentThreadId;
  const report = getLatestPromptContextReport(threadId);
  const baseMessage = formatPromptContextReport(report);
  const compactionBlock = _lastCompactionDetails && _lastCompactionAt
    ? formatCompactionDetails(_lastCompactionDetails, _lastCompactionAt)
    : "";
  return {
    success: report !== null || _lastCompactionDetails !== null,
    message: compactionBlock ? `${baseMessage}${compactionBlock}` : baseMessage,
  };
}
