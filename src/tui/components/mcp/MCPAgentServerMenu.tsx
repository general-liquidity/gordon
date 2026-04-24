import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";
import { Divider } from "../Divider.js";

// ============================================================================
// MCPAgentServerMenu — Assign MCP servers to specific Gordon sub-agents
//
// Two-column layout:
//   Left  = agent list (arrow keys to choose agent)
//   Right = server picker for selected agent
//
// "Assign Scanner to: [Binance Adapter ▾]"
// ============================================================================

interface MCPServer {
  id: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  status: "connected" | "disconnected" | "error" | "reconnecting";
  toolCount: number;
  resourceCount?: number;
  latencyMs?: number;
  endpoint?: string;
  description?: string;
}

interface Props {
  agents: Array<{ name: string; currentServer?: string }>;
  servers: MCPServer[];
  onAssign: (agentName: string, serverId: string) => void;
  onClose: () => void;
}

type PanelFocus = "agents" | "servers";

const UNASSIGNED_OPTION = { label: "— None —", value: "__none__" };

export function MCPAgentServerMenu({ agents, servers, onAssign, onClose }: Props) {
  const [agentIdx, setAgentIdx] = useState(0);
  const [panelFocus, setPanelFocus] = useState<PanelFocus>("agents");

  const selectedAgent = agents[agentIdx];

  useInput((_input, key) => {
    if (key.escape) {
      if (panelFocus === "servers") {
        setPanelFocus("agents");
      } else {
        onClose();
      }
      return;
    }

    if (panelFocus === "agents") {
      if (key.upArrow) {
        setAgentIdx((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setAgentIdx((i) => Math.min(agents.length - 1, i + 1));
      } else if (key.return || key.rightArrow) {
        if (servers.length > 0) setPanelFocus("servers");
      }
    }
    // server panel input is handled by GordonSelect
  });

  const serverOptions = [
    UNASSIGNED_OPTION,
    ...servers.map((s) => ({
      label: `${s.name} (${s.transport}, ${s.toolCount} tools)`,
      value: s.id,
    })),
  ];

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">ASSIGN MCP SERVERS TO AGENTS</Text>
      </Box>

      <Divider />

      <Box marginTop={1} gap={4}>
        {/* Left: agent list */}
        <Box flexDirection="column" width={26}>
          <Text bold dimColor>AGENT</Text>
          {agents.map((agent, i) => {
            const isFocused = i === agentIdx;
            const currentServerName =
              servers.find((s) => s.id === agent.currentServer)?.name ?? "none";
            return (
              <Box key={agent.name} flexDirection="column">
                <Box>
                  <Text color={isFocused && panelFocus === "agents" ? "cyanBright" : undefined}>
                    {isFocused && panelFocus === "agents" ? "▸ " : "  "}
                  </Text>
                  <Text
                    bold={isFocused}
                    color={isFocused && panelFocus === "agents" ? "cyanBright" : undefined}
                  >
                    {agent.name}
                  </Text>
                </Box>
                {isFocused && (
                  <Box>
                    <Text dimColor>    → {currentServerName}</Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>

        {/* Vertical divider */}
        <Box flexDirection="column">
          <Text dimColor>│</Text>
          {agents.map((_, i) => (
            <Text key={i} dimColor>│</Text>
          ))}
        </Box>

        {/* Right: server picker */}
        <Box flexDirection="column">
          {selectedAgent ? (
            <>
              <Text bold dimColor>
                Assign <Text color="cyanBright">{selectedAgent.name}</Text> to:
              </Text>
              {panelFocus === "servers" ? (
                <Box marginTop={1}>
                  <Select
                    options={serverOptions}
                    onChange={(serverId) => {
                      if (serverId !== "__none__" && selectedAgent) {
                        onAssign(selectedAgent.name, serverId);
                      }
                      setPanelFocus("agents");
                    }}
                  />
                </Box>
              ) : (
                <Box marginTop={1}>
                  <Text dimColor>
                    {servers.find((s) => s.id === selectedAgent.currentServer)?.name ?? "— None —"}
                  </Text>
                  <Text dimColor>  (Enter to change)</Text>
                </Box>
              )}
            </>
          ) : (
            <Text dimColor>No agents configured.</Text>
          )}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {panelFocus === "agents"
            ? "↑↓ select agent  Enter/→ pick server  Esc close"
            : "↑↓ select server  Enter assign  Esc back"}
        </Text>
      </Box>
    </Box>
  );
}
