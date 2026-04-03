import React from "react";
import { Box, Text } from "ink";

/**
 * HelpRenderer -- Grouped command help display
 * Phase 10: Commands grouped by workflow with icons:
 *   DISCOVER  ANALYZE  TRADE  RUN  ACCOUNTS  OPERATE
 */

interface HelpCommand {
  name: string;
  description: string;
  workflow: string;
}

interface Props {
  commands: HelpCommand[];
}

/** Workflow group icons matching WORKFLOW_CONFIG from commandUx.ts */
const WORKFLOW_ICONS: Record<string, { icon: string; color: string }> = {
  discover: { icon: "\u25C6", color: "cyanBright" },   // filled diamond
  analyze:  { icon: "\u25C8", color: "magenta" },      // diamond in circle
  trade:    { icon: "\u25B2", color: "green" },         // up triangle
  run:      { icon: "\u25C7", color: "yellow" },        // open diamond
  accounts: { icon: "\u25A0", color: "blue" },          // filled square
  operate:  { icon: "\u25CF", color: "white" },         // filled circle
};

/** Display order for workflow groups */
const WORKFLOW_ORDER = ["discover", "analyze", "trade", "run", "accounts", "operate"];

export function HelpRenderer({ commands }: Props) {
  // Group commands by workflow
  const grouped = new Map<string, HelpCommand[]>();
  for (const cmd of commands) {
    const key = cmd.workflow.toLowerCase();
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(cmd);
  }

  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      {WORKFLOW_ORDER.map((workflow) => {
        const cmds = grouped.get(workflow);
        if (!cmds || cmds.length === 0) return null;

        const config = WORKFLOW_ICONS[workflow] ?? { icon: "\u25CB", color: "white" };

        return (
          <Box key={workflow} flexDirection="column" marginBottom={1}>
            {/* Group header */}
            <Box>
              <Text color={config.color} bold>
                {config.icon} {workflow.toUpperCase()}
              </Text>
            </Box>

            {/* Commands in this group */}
            {cmds.map((cmd) => (
              <Box key={cmd.name} paddingLeft={2}>
                <Box width={20}>
                  <Text color="cyanBright">/{cmd.name}</Text>
                </Box>
                <Text dimColor>{cmd.description}</Text>
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
