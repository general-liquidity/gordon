export const ACTION_LOG_ENTRY_TYPES = [
  "user_message",
  "assistant_message",
  "action_route",
  "run_status",
  "agent_switch",
  "tool_call",
  "tool_result",
  "queue_update",
  "execution_preview",
  "execution_attempt",
  "execution_result",
  "validation_report",
  "backtest_result",
  "optimization_result",
  "runtime_health",
  "decay_report",
  "portfolio_report",
  "scheduler_event",
  "autonomous_cycle",
  "daemon_event",
  "reconciliation_event",
  "monitor_event",
  "branch_summary",
  "compaction_summary",
  "label",
  "bookmark",
  "model_change",
  "profile_change",
  "venue_change",
  "provider_event",
  "custom",
] as const;

export type ActionLogEntryType = (typeof ACTION_LOG_ENTRY_TYPES)[number];

export interface ActionLogEntry {
  id: string;
  threadId?: string;
  resourceId?: string;
  sessionId?: string;
  correlationId?: string;
  runId?: string;
  parentEntryId?: string;
  entryType: ActionLogEntryType;
  title: string;
  content: string;
  payload: Record<string, unknown>;
  label?: string;
  bookmarked: boolean;
  createdAt: string;
}

export interface AppendActionLogEntryInput {
  id?: string;
  threadId?: string;
  resourceId?: string;
  sessionId?: string;
  correlationId?: string;
  runId?: string;
  parentEntryId?: string;
  entryType: ActionLogEntryType;
  title: string;
  content?: string;
  payload?: Record<string, unknown>;
  label?: string;
  bookmarked?: boolean;
  createdAt?: string;
}

export interface ListActionLogEntriesOptions {
  threadId?: string;
  resourceId?: string;
  sessionId?: string;
  correlationId?: string;
  runId?: string;
  parentEntryId?: string;
  entryTypes?: ActionLogEntryType[];
  bookmarkedOnly?: boolean;
  limit?: number;
}

export const ACTION_LOG_GROUP_ALIASES = {
  messages: ["user_message", "assistant_message"],
  tools: ["tool_call", "tool_result"],
  runtime: ["run_status", "action_route", "queue_update", "runtime_health", "monitor_event"],
  daemon: ["daemon_event", "scheduler_event", "autonomous_cycle", "reconciliation_event"],
  summaries: ["branch_summary", "compaction_summary"],
} as const satisfies Record<string, readonly ActionLogEntryType[]>;

export type ActionLogGroupAlias = keyof typeof ACTION_LOG_GROUP_ALIASES;

export function isActionLogEntryType(value: string): value is ActionLogEntryType {
  return (ACTION_LOG_ENTRY_TYPES as readonly string[]).includes(value);
}

export function isActionLogGroupAlias(value: string): value is ActionLogGroupAlias {
  return Object.hasOwn(ACTION_LOG_GROUP_ALIASES, value);
}
