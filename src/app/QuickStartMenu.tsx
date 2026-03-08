import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Badge } from "@inkjs/ui";
import { FocusSelect } from "./components/PromptPrimitives.tsx";
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
    { label: "Scan", value: "scan" },
    { label: "Trending", value: "trending" },
    { label: "Regime", value: "regime" },
  ],
  analyze: [
    { label: "Analyze", value: "analyze" },
    { label: "Plan", value: "plan" },
    { label: "Help", value: "help" },
  ],
  trade: [
    { label: "Preview", value: "preview-order" },
    { label: "Positions", value: "positions" },
    { label: "Orders", value: "orders" },
    { label: "Fund", value: "fund" },
    { label: "Bridge", value: "bridge" },
  ],
  run: [
    { label: "Runtime", value: "strategies-live" },
    { label: "Regime", value: "regime" },
    { label: "Help", value: "help" },
  ],
  accounts: [
    { label: "Portfolio", value: "portfolio" },
    { label: "Wallet", value: "wallet" },
    { label: "Chains", value: "chains" },
  ],
  operate: [
    { label: "Chat", value: "chat" },
    { label: "Doctor", value: "doctor" },
    { label: "Setup", value: "setup" },
    { label: "Help", value: "help" },
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
      return "Chat";
    case "scan":
      return "Scan";
    case "portfolio":
      return "Portfolio";
    case "trending":
      return "Trending";
    case "analyze":
      return "Analyze";
    case "preview-order":
      return "Preview";
    case "plan":
      return "Plan";
    case "positions":
      return "Positions";
    case "orders":
      return "Orders";
    case "strategies-live":
      return "Runtime";
    case "regime":
      return "Regime";
    case "bridge":
      return "Bridge";
    case "chains":
      return "Chains";
    case "wallet":
      return "Wallet";
    case "fund":
      return "Fund";
    case "setup":
      return "Setup";
    case "doctor":
      return "Doctor";
    case "help":
      return "Help";
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
    label: getMenuLabel(option),
    value: option as MenuSelection,
  }));

  const workflows = (Object.keys(WORKFLOW_CONFIG) as WorkflowGroup[]).map((workflow) => ({
    label: WORKFLOW_CONFIG[workflow].label,
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
      { label: "All actions", value: "back" as const },
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
  const modeLabel = mode === "ARMED" ? "Live enabled" : "Read-only";
  const title = isOverlay ? "Action Palette" : "Quick Actions";
  const subtitle = workflow === "root"
    ? isOverlay
      ? "Pick an action or start typing to return to chat."
      : "Pick the next action or start typing to jump into chat."
    : WORKFLOW_CONFIG[workflow].label;
  const hintText = isOverlay
    ? "Ctrl+K toggles the palette. Typing jumps straight back to chat."
    : "Press Enter to launch an action. Typing jumps straight to chat.";

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1} gap={2}>
        <Text color={COLORS.ACCENT} bold>
          {title}
        </Text>
        <Badge color={mode === "ARMED" ? "red" : "green"}>
          {modeLabel}
        </Badge>
        <Badge color={!setupComplete || !hasVenue ? "blue" : "green"}>
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
        <FocusSelect
          title={workflow === "root" ? undefined : WORKFLOW_CONFIG[workflow].label}
          hint={workflow === "root" ? "Start with one action. Chat handles the rest." : undefined}
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
            {mode === "SAFE" ? "[READ-ONLY]" : "[LIVE ENABLED]"}
          </Text>
          <Text color={COLORS.DIM}>
            {mode === "SAFE"
              ? "Analysis and previews only. No live orders will execute."
              : "Live trading is enabled. Gordon will still require approval on execution paths."}
          </Text>
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>
              Type <Text color={COLORS.ACCENT}>/arm</Text> or <Text color={COLORS.ACCENT}>/disarm</Text> to change execution permission
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
              Recommended flow: scan, analyze one symbol, then preview before execution.
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default QuickStartMenu;
