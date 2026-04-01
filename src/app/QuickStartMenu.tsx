import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Badge } from "@inkjs/ui";
import { FocusSelect } from "./components/PromptPrimitives.tsx";
import { COLORS } from "./theme.ts";
import type { Mode } from "../types/index.ts";
import { WORKFLOW_CONFIG, type WorkflowGroup } from "./commandUx.ts";
import { DeskPanel } from "./components/desk/DeskPanel.tsx";
import { TicketCard } from "./components/desk/TicketCard.tsx";
import { BlotterRow } from "./components/desk/BlotterRow.tsx";

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
      <DeskPanel
        eyebrow={isOverlay ? "Action Palette" : "Desk Actions"}
        title={title}
        subtitle={subtitle}
        tone="brand"
      >
        <Box gap={2} marginBottom={1}>
          <Badge color={mode === "ARMED" ? "red" : "green"}>
            {modeLabel}
          </Badge>
          <Badge color={!setupComplete || !hasVenue ? "blue" : "green"}>
            {readinessLabel}
          </Badge>
        </Box>
        <Text color={COLORS.DIM}>
          {workflow === "root"
            ? connectedLabel
              ? `Connected: ${connectedLabel}`
              : "Connected: none yet"
            : WORKFLOW_CONFIG[workflow].description}
        </Text>
      </DeskPanel>

      {workflow === "root" && (
        <Box flexDirection="column" marginTop={1}>
          <Box marginBottom={1}>
            <TicketCard
              eyebrow="Desk Posture"
              title={mode === "SAFE" ? "Read-only desk" : "Live desk enabled"}
              subtitle={
                mode === "SAFE"
                  ? "Scan, analyze, and preview. No live execution."
                  : "Execution paths are available, but Gordon still requests approval."
              }
              tone={mode === "SAFE" ? "info" : "danger"}
              actions={["/arm", "/disarm"]}
            >
              <Text color={COLORS.DIM}>
                {mode === "SAFE"
                  ? "Use SAFE while shaping the thesis and trade ticket."
                  : "Use ARMED only when the desk is staffed and approvals are intentional."}
              </Text>
            </TicketCard>
          </Box>
          <DeskPanel eyebrow="Recommended Flow" title="Run the desk in sequence" tone="operate" compact>
            <BlotterRow label="1" value="Scan the tape" detail="Start with movers, regime, or one symbol." tone="info" />
            <BlotterRow label="2" value="Build the ticket" detail="Analyze, plan, and pressure-test the setup." tone="analysis" />
            <BlotterRow label="3" value="Preview before action" detail="Route into preview or live execution only after the thesis is clean." tone="success" />
          </DeskPanel>
        </Box>
      )}

      <Box marginTop={1}>
        <FocusSelect
          title={workflow === "root" ? "Choose the next desk action" : WORKFLOW_CONFIG[workflow].label}
          hint={workflow === "root" ? "One move is enough. Typing jumps straight back into chat." : "Workflow actions stay narrow on purpose."}
          options={menuOptions}
          onChange={handleSelection}
        />
      </Box>

      <Box marginTop={1}>
        <DeskPanel eyebrow="Desk Shortcuts" title="Move fast" subtitle={hintText} tone="neutral" compact>
          <Text color={COLORS.WHITE}>
            Use <Text color={COLORS.ACCENT}>/help discover</Text>, <Text color={COLORS.ACCENT}>/help trade</Text>, or <Text color={COLORS.ACCENT}>/help operate</Text> to browse the desk by workflow.
          </Text>
        </DeskPanel>
      </Box>
    </Box>
  );
};

export default QuickStartMenu;
