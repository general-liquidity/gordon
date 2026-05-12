import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";

/**
 * CLIBrowser — Browse trading CLIs, check installation status
 *
 * /cli opens this dialog:
 *   - List all 8 registered trading CLIs
 *   - Show install status (installed/not installed)
 *   - View commands and capabilities
 *   - Copy install command
 */

interface CLITool {
  id: string;
  name: string;
  description: string;
  bin: string;
  install: string;
  nativeCoverage: "full" | "partial" | "none";
  hasMCP: boolean;
  pricing: string;
  pricingNote?: string;
  markets: string[];
  commandCount: number;
  installed?: boolean;
}

interface Props {
  tools: CLITool[];
  onInstall: (toolId: string, installCommand: string) => void;
  onCancel: () => void;
}

const COVERAGE_LABELS: Record<string, string> = {
  full: "Full native coverage",
  partial: "Partial native coverage",
  none: "No native coverage — CLI adds new capabilities",
};

const COVERAGE_COLORS: Record<string, string> = {
  full: "green",
  partial: "yellow",
  none: "red",
};

export function CLIBrowser({ tools, onInstall, onCancel }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [detailTool, setDetailTool] = useState<CLITool | null>(null);

  useInput((_input, key) => {
    if (key.escape) {
      if (detailTool) setDetailTool(null);
      else onCancel();
      return;
    }
    if (detailTool) return;
    if (key.return) {
      const tool = tools[selectedIdx];
      if (tool) setDetailTool(tool);
      return;
    }
    if (key.upArrow) setSelectedIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIdx((i) => Math.min(tools.length - 1, i + 1));
  });

  // ── Detail view ──
  if (detailTool) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyanBright">{detailTool.name}</Text>
        <Text dimColor>{detailTool.description}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Binary: <Text color="yellow">{detailTool.bin}</Text></Text>
          <Text>Markets: {detailTool.markets.join(", ")}</Text>
          <Text>Commands: {detailTool.commandCount}</Text>
          <Text>MCP mode: {detailTool.hasMCP ? "Yes" : "No"}</Text>
          <Text>Pricing: {detailTool.pricing}{detailTool.pricingNote ? ` — ${detailTool.pricingNote}` : ""}</Text>
          <Text>Native coverage: <Text color={COVERAGE_COLORS[detailTool.nativeCoverage] as any}>{COVERAGE_LABELS[detailTool.nativeCoverage]}</Text></Text>
          <Text color="green">Install: {detailTool.install}</Text>
        </Box>
        <Box marginTop={1}>
          <Select
            options={[
              { label: `Install: ${detailTool.install}`, value: "install" },
              { label: "Back to list", value: "back" },
            ]}
            onChange={(v) => {
              if (v === "install") onInstall(detailTool.id, detailTool.install);
              setDetailTool(null);
            }}
          />
        </Box>
        <Box marginTop={1}><Text dimColor>Esc to go back</Text></Box>
      </Box>
    );
  }

  // ── List view ──
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">TRADING CLIs</Text>
        <Text dimColor>  ({tools.length} registered)</Text>
      </Box>

      <Box flexDirection="column">
        {tools.map((tool, i) => {
          const isFocused = i === selectedIdx;
          const statusIcon = tool.installed ? "\u2713" : "\u25CB";
          const statusColor = tool.installed ? "green" : "gray";
          return (
            <Box key={tool.id}>
              <Text color={isFocused ? "cyanBright" : undefined}>{isFocused ? " \u25B8" : "  "}</Text>
              <Text color={statusColor}> {statusIcon} </Text>
              <Text color={isFocused ? "cyanBright" : undefined} bold={isFocused}>{tool.name.padEnd(20)}</Text>
              <Text color={COVERAGE_COLORS[tool.nativeCoverage] as any}>{tool.nativeCoverage.padEnd(10)}</Text>
              <Text dimColor={!isFocused}>{tool.markets.join(", ")}</Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{"\u2191\u2193"} scroll {"\u00B7"} Enter details {"\u00B7"} Esc close</Text>
      </Box>
    </Box>
  );
}
