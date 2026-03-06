import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Select, Badge } from "@inkjs/ui";
import { COLORS } from "./theme.ts";
import type { Mode } from "../types/index.ts";
import { WORKFLOW_CONFIG, type WorkflowGroup } from "./commandUx.ts";

export type MenuOption =
  | "chat"
  | "scan"
  | "portfolio"
  | "trending"
  | "analyze"
  | "preview-order"
  | "plan"
  | "positions"
  | "orders"
  | "strategies-live"
  | "regime"
  | "bridge"
  | "chains"
  | "wallet"
  | "fund"
  | "setup"
  | "doctor"
  | "help";

type MenuSelection = MenuOption | `workflow:${WorkflowGroup}` | "back";
type MenuWorkflowState = "root" | WorkflowGroup;

interface QuickStartMenuProps {
  onSelect: (option: MenuOption) => void;
  onTypeToChat?: (seed: string) => void;
  mode?: Mode;
  setupComplete?: boolean;
  hasExchange?: boolean;
  hasBroker?: boolean;
  hasWalletRails?: boolean;
  hasMcpServers?: boolean;
  variant?: "home" | "overlay";
}

interface MenuEntry {
  label: string;
  value: MenuSelection;
}

const WORKFLOW_ACTIONS: Record<WorkflowGroup, MenuEntry[]> = {
  discover: [
    { label: "Scan market for fresh setups", value: "scan" },
    { label: "See what is trending right now", value: "trending" },
    { label: "Check current market regime", value: "regime" },
  ],
  analyze: [
    { label: "Analyze a single market", value: "analyze" },
    { label: "Build a trade plan", value: "plan" },
    { label: "Open command guide for analysis", value: "help" },
  ],
  trade: [
    { label: "Preview a trade before execution", value: "preview-order" },
    { label: "Review open positions", value: "positions" },
    { label: "Review working orders", value: "orders" },
    { label: "Fund or quote wallet rails", value: "fund" },
    { label: "Bridge assets across chains", value: "bridge" },
  ],
  run: [
    { label: "Open live strategy dashboard", value: "strategies-live" },
    { label: "Check current market regime", value: "regime" },
    { label: "Open command guide for strategy workflows", value: "help" },
  ],
  accounts: [
    { label: "Review portfolio and balances", value: "portfolio" },
    { label: "Inspect wallet rails and history", value: "wallet" },
    { label: "Inspect configured chains", value: "chains" },
  ],
  operate: [
    { label: "Return to open chat", value: "chat" },
    { label: "Run diagnostics", value: "doctor" },
    { label: "Open setup and configuration", value: "setup" },
    { label: "Open command guide", value: "help" },
  ],
};

export function buildQuickStartRecommendedOptions(context: {
  mode: Mode;
  setupComplete: boolean;
  hasExchange: boolean;
  hasBroker: boolean;
  hasWalletRails: boolean;
}): MenuOption[] {
  const hasVenue = context.hasExchange || context.hasBroker;

  if (!context.setupComplete || !hasVenue) {
    return ["chat", "setup", "doctor", "help", "analyze"];
  }

  const recommended: MenuOption[] = [
    "chat",
    "scan",
    "analyze",
    "portfolio",
    context.mode === "ARMED" ? "orders" : "preview-order",
  ];

  recommended.push(context.hasWalletRails ? "fund" : "doctor");
  return recommended;
}

function getMenuLabel(option: MenuOption): string {
  switch (option) {
    case "chat":
      return "Ask Gordon in chat";
    case "scan":
      return "Scan market for opportunities";
    case "portfolio":
      return "Review portfolio and balances";
    case "trending":
      return "See trending markets";
    case "analyze":
      return "Analyze a market";
    case "preview-order":
      return "Preview a trade";
    case "plan":
      return "Create a trade plan";
    case "positions":
      return "Check active positions";
    case "orders":
      return "Check live orders";
    case "strategies-live":
      return "Open strategy runtime";
    case "regime":
      return "Check market regime";
    case "bridge":
      return "Bridge assets";
    case "chains":
      return "Inspect chains";
    case "wallet":
      return "Inspect wallet rails";
    case "fund":
      return "Fund or quote wallet rails";
    case "setup":
      return "Open setup and configuration";
    case "doctor":
      return "Run doctor diagnostics";
    case "help":
      return "Open command guide";
    default:
      return option;
  }
}

function buildRootOptions(context: {
  mode: Mode;
  setupComplete: boolean;
  hasExchange: boolean;
  hasBroker: boolean;
  hasWalletRails: boolean;
}): MenuEntry[] {
  const recommendedOptions = Array.from(new Set(buildQuickStartRecommendedOptions(context)));
  const recommended = recommendedOptions.map((option) => ({
    label: `Now: ${getMenuLabel(option)}`,
    value: option as MenuSelection,
  }));

  const workflows = (Object.keys(WORKFLOW_CONFIG) as WorkflowGroup[]).map((workflow) => ({
    label: `Workflow: ${WORKFLOW_CONFIG[workflow].label} - ${WORKFLOW_CONFIG[workflow].description}`,
    value: `workflow:${workflow}` as const,
  }));

  return [...recommended, ...workflows];
}

export const QuickStartMenu: React.FC<QuickStartMenuProps> = ({
  onSelect,
  onTypeToChat,
  mode = "SAFE",
  setupComplete = false,
  hasExchange = false,
  hasBroker = false,
  hasWalletRails = false,
  hasMcpServers = false,
  variant = "home",
}) => {
  const [workflow, setWorkflow] = useState<MenuWorkflowState>("root");
  const hasVenue = hasExchange || hasBroker;

  const menuOptions = useMemo(() => {
    if (workflow === "root") {
      return buildRootOptions({ mode, setupComplete, hasExchange, hasBroker, hasWalletRails });
    }

    return [
      ...WORKFLOW_ACTIONS[workflow],
      { label: "Back to workflow overview", value: "back" as const },
    ];
  }, [workflow, mode, setupComplete, hasExchange, hasBroker, hasWalletRails]);

  const readinessLabel = !setupComplete || !hasVenue
    ? "Needs setup"
    : hasWalletRails
      ? "Ready with rails"
      : "Ready";

  const connectedLabel = [
    hasExchange ? "exchange" : null,
    hasBroker ? "broker" : null,
    hasWalletRails ? "wallet rails" : null,
    hasMcpServers ? "mcp" : null,
  ].filter(Boolean).join(", ");

  const handleSelection = (value: string): void => {
    if (value === "back") {
      setWorkflow("root");
      return;
    }

    if (value.startsWith("workflow:")) {
      setWorkflow(value.slice("workflow:".length) as WorkflowGroup);
      return;
    }

    onSelect(value as MenuOption);
  };

  useInput((input, key) => {
    if (!onTypeToChat) {
      return;
    }

    if (
      key.ctrl
      || key.meta
      || key.shift
      || key.escape
      || key.return
      || key.tab
      || key.backspace
      || key.delete
      || key.leftArrow
      || key.rightArrow
      || key.upArrow
      || key.downArrow
    ) {
      return;
    }

    if (input === "?" || input.length !== 1 || !/\S/.test(input)) {
      return;
    }

    onTypeToChat(input);
  }, { isActive: Boolean(onTypeToChat) });

  const isOverlay = variant === "overlay";
  const title = isOverlay ? "Action Palette" : "Quick Actions";
  const subtitle = workflow === "root"
    ? isOverlay
      ? "Browse actions or start typing to jump back into chat."
      : "Choose the next best action or start typing to talk to Gordon."
    : `${WORKFLOW_CONFIG[workflow].label} workflow`;
  const hintText = isOverlay
    ? "Ctrl+K toggles this palette. Type any prompt to return to chat instantly."
    : "Press Enter to launch an action, or type any prompt to jump straight into chat.";

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1} gap={2}>
        <Text color={COLORS.ACCENT} bold>
          {title}
        </Text>
        <Badge color={mode === "ARMED" ? "red" : "green"}>
          {mode === "ARMED" ? "ARMED" : "SAFE"}
        </Badge>
        <Badge color={!setupComplete || !hasVenue ? "yellow" : "green"}>
          {readinessLabel}
        </Badge>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text color={COLORS.WHITE} bold>
          {subtitle}
        </Text>
        <Text color={COLORS.DIM}>
          {workflow === "root"
            ? connectedLabel
              ? `Connected: ${connectedLabel}`
              : "Connected: none yet"
            : WORKFLOW_CONFIG[workflow].description}
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Select
          options={menuOptions}
          onChange={handleSelection}
        />
      </Box>

      <Box
        borderStyle="single"
        borderColor={mode === "ARMED" ? COLORS.RED : COLORS.GREEN}
        paddingX={2}
        paddingY={1}
        marginTop={1}
      >
        <Box flexDirection="column">
          <Text color={COLORS.WHITE} bold>
            {mode === "SAFE" ? "[SAFE MODE]" : "[ARMED MODE]"}
          </Text>
          <Text color={COLORS.DIM}>
            {mode === "SAFE"
              ? "Analysis and previews only. No live trades will execute."
              : "Live trading is enabled. Gordon will still require approval on execution paths."}
          </Text>
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              Type <Text color={COLORS.ACCENT}>/arm</Text> or <Text color={COLORS.ACCENT}>/disarm</Text> to change execution state
            </Text>
          </Box>
        </Box>
      </Box>

      <Box
        borderStyle="round"
        borderColor={COLORS.DIM}
        paddingX={2}
        paddingY={1}
        marginTop={1}
      >
        <Box flexDirection="column">
          <Text color={COLORS.WHITE}>
            Use <Text color={COLORS.ACCENT}>/help discover</Text>, <Text color={COLORS.ACCENT}>/help trade</Text>, or <Text color={COLORS.ACCENT}>/help operate</Text> to browse workflows directly.
          </Text>
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              {hintText}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              Recommended flow: scan the market, analyze one symbol, then preview a trade before execution.
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default QuickStartMenu;
