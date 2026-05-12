import React from "react";
import { Box, Text } from "../../ink-custom";
import { WorkerBadge } from "./WorkerBadge.js";
import { HandoffArrow } from "./HandoffArrow.js";
import { Byline } from "../layout/Byline.tsx";

// ============================================================================
// AgentProgress — Multi-chain task tree with handoff arrows
//
// Supports parallel agents (multiple chains) and handoff transitions.
//
// GORDON · Scanner (BTC)                              3.2s
//   ├─ Market data ✓
//   └─ Setup detection ✓
//
// → Handing off to Analyst
//
// GORDON · Analyst (BTC)
//   ├─ RSI analysis ✓
//   └─ Pattern recognition ●
// ============================================================================

export interface ProgressNode {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error" | "cancelled";
  duration?: number;
  children?: ProgressNode[];
}

export interface AgentChain {
  id: string;
  agentName: string;
  symbol?: string;
  status: "running" | "done" | "error";
  startedAt: number;
  duration?: number;
  nodes: ProgressNode[];
}

export interface HandoffEvent {
  from: string;
  to: string;
  timestamp: number;
}

interface Props {
  chains: AgentChain[];
  handoffs: HandoffEvent[];
  tokenCount?: number;
}

const STATUS_ICONS: Record<string, string> = {
  pending: "\u25CB",   // ○
  running: "\u25CF",   // ●
  done: "\u2713",      // ✓
  error: "\u2717",     // ✗
  cancelled: "\u2012", // ‒
};

const STATUS_COLORS: Record<string, string> = {
  pending: "gray",
  running: "cyanBright",
  done: "green",
  error: "red",
  cancelled: "gray",
};

export function AgentProgress({ chains, handoffs, tokenCount }: Props) {
  if (chains.length === 0) return null;

  const elements: React.ReactNode[] = [];

  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i]!;

    // Check if there was a handoff before this chain
    if (i > 0) {
      const prevChain = chains[i - 1]!;
      const handoff = handoffs.find(
        (h) => h.from === prevChain.agentName && h.to === chain.agentName
      );
      if (handoff) {
        elements.push(
          <HandoffArrow key={`handoff-${i}`} from={prevChain.agentName} to={chain.agentName} />
        );
      }
    }

    // Agent chain header
    const durationStr = chain.duration ? formatMs(chain.duration) : chain.status === "running" ? "" : undefined;
    elements.push(
      <Box key={`chain-${chain.id}`} flexDirection="column" marginTop={i > 0 ? 0 : 1}>
        <Box>
          <Text bold color="cyanBright">GORDON</Text>
          <Text dimColor> {"\u00b7"} </Text>
          <WorkerBadge agent={chain.agentName} showBullet={false} />
          {chain.symbol && <Text dimColor> ({chain.symbol})</Text>}
          {durationStr && (
            <>
              <Text> </Text>
              <Byline parts={[
                chain.status === "done" ? `done \u00b7 ${durationStr}` : durationStr,
                ...(tokenCount != null && i === chains.length - 1 ? [`${formatTokens(tokenCount)}`] : []),
              ]} />
            </>
          )}
        </Box>

        {/* Task nodes */}
        {chain.nodes.map((node, j) => (
          <NodeView
            key={node.id}
            node={node}
            isLast={j === chain.nodes.length - 1}
            depth={1}
          />
        ))}
      </Box>
    );
  }

  return <>{elements}</>;
}

function NodeView({ node, isLast, depth }: {
  node: ProgressNode;
  isLast: boolean;
  depth: number;
}) {
  const connector = isLast ? "\u2514\u2500" : "\u251C\u2500";
  const icon = STATUS_ICONS[node.status] ?? "\u25CB";
  const iconColor = STATUS_COLORS[node.status] ?? "gray";
  const indent = "  ".repeat(depth);
  const durationStr = node.duration ? ` (${formatMs(node.duration)})` : "";

  return (
    <>
      <Box>
        <Text dimColor>{indent}{connector} </Text>
        <Text color={iconColor}>{icon} </Text>
        <Text dimColor={node.status === "pending"}>
          {node.label}{durationStr}
        </Text>
      </Box>
      {node.children?.map((child, i) => (
        <NodeView
          key={child.id}
          node={child}
          isLast={i === (node.children?.length ?? 1) - 1}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K tok`;
  return `${n} tok`;
}
