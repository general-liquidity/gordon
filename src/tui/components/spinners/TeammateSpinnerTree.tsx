import React from "react";
import { Box, Text } from "../../ink-custom";
import { TeammateSpinnerLine } from "./TeammateSpinnerLine.js";

// ============================================================================
// TeammateSpinnerTree — Multi-agent task tree shown during multi-agent runs
//
// Renders a compact tree of active/completed agent tasks:
//
//   ┌─ Agent tasks
//   ├─ ✓ Scanner   2.1s
//   ├─ ● Analyst   Analyzing charts...
//   └─ ○ Executor  waiting
//
// Only the most recent maxVisible agents are shown; excess agents are
// summarised as "  +N more".
// ============================================================================

type AgentStatus = "running" | "done" | "error" | "pending" | "waiting";

export interface AgentTask {
  agentName: string;
  status: AgentStatus;
  taskLabel?: string;
  /** Unix timestamp (ms) when this agent started */
  startedAt?: number;
  /** Unix timestamp (ms) when this agent finished */
  endedAt?: number;
}

interface Props {
  agents: AgentTask[];
  /** Maximum number of agent lines to render — default 5 */
  maxVisible?: number;
}

function durationMs(task: AgentTask): number | undefined {
  if (task.startedAt == null) return undefined;
  const end = task.endedAt ?? Date.now();
  return end - task.startedAt;
}

export function TeammateSpinnerTree({ agents, maxVisible = 5 }: Props) {
  if (agents.length === 0) return null;

  const visible = agents.slice(0, maxVisible);
  const overflow = agents.length - visible.length;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {/* Tree header */}
      <Box>
        <Text dimColor>{"┌─ "}</Text>
        <Text dimColor>Agent tasks</Text>
      </Box>

      {/* Agent lines */}
      {visible.map((task, i) => {
        const isLast = i === visible.length - 1 && overflow === 0;
        return (
          <TeammateSpinnerLine
            key={task.agentName}
            agentName={task.agentName}
            status={task.status}
            taskLabel={task.taskLabel}
            duration={durationMs(task)}
            isLast={isLast}
          />
        );
      })}

      {/* Overflow count */}
      {overflow > 0 && (
        <Box>
          <Text dimColor>{"└─ "}</Text>
          <Text dimColor>{`+${overflow} more`}</Text>
        </Box>
      )}
    </Box>
  );
}
