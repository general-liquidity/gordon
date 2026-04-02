import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

import type { Mode } from "../types/index.ts";
import { COLORS } from "./theme.ts";
import { DeskPanel } from "./components/desk/DeskPanel.tsx";

export type MenuOption =
  | "chat"
  | "scan"
  | "portfolio"
  | "setup"
  | "doctor"
  | "help"
  | "trending"
  | "analyze"
  | "preview-order"
  | "plan"
  | "positions"
  | "orders"
  | "wallet"
  | "fund"
  | "strategies-live"
  | "regime"
  | "bridge"
  | "chains";

export function buildQuickStartRecommendedOptions(input: {
  mode: Mode;
  setupComplete: boolean;
  hasExchange: boolean;
  hasBroker: boolean;
  hasWalletRails: boolean;
}): MenuOption[] {
  if (!input.setupComplete || (!input.hasExchange && !input.hasBroker)) {
    return ["chat", "setup", "doctor", "help", "scan", "portfolio"];
  }
  if (input.mode === "ARMED") {
    return ["chat", "scan", "orders", "positions", "preview-order", "plan"];
  }
  return [
    "chat",
    "scan",
    "portfolio",
    "plan",
    "orders",
    input.hasWalletRails ? "fund" : "strategies-live",
  ];
}

const COPY: Record<MenuOption, { title: string; detail: string }> = {
  chat: { title: "Open Desk", detail: "Natural-language trading terminal." },
  scan: { title: "Scan Market", detail: "Build a shortlist from the tape." },
  portfolio: { title: "Portfolio", detail: "Review book, balances, and exposure." },
  setup: { title: "Setup", detail: "Configure providers, venues, rails, and MCP." },
  doctor: { title: "Doctor", detail: "Inspect readiness and environment state." },
  help: { title: "Help", detail: "Open the command book." },
  trending: { title: "Trending", detail: "See movers and momentum." },
  analyze: { title: "Analyze Symbol", detail: "Jump into a single-name dossier." },
  "preview-order": { title: "Preview Order", detail: "Open the execution review path." },
  plan: { title: "Create Plan", detail: "Start a ticket sheet." },
  positions: { title: "Positions", detail: "Inspect live positions." },
  orders: { title: "Orders", detail: "Inspect active orders." },
  wallet: { title: "Wallet", detail: "Inspect funding rails." },
  fund: { title: "Fund", detail: "Quote agent rails and transfer path." },
  "strategies-live": { title: "Live Strategies", detail: "Inspect deployed strategy runtime." },
  regime: { title: "Regime", detail: "Inspect macro tape state." },
  bridge: { title: "Bridge", detail: "Route assets across chains." },
  chains: { title: "Chains", detail: "Inspect configured chain surfaces." },
};

export const QuickStartMenu: React.FC<{
  onSelect: (option: MenuOption) => void;
  onTypeToChat: (seed: string) => void;
  mode: Mode;
  setupComplete: boolean;
  hasExchange: boolean;
  hasBroker: boolean;
  hasWalletRails: boolean;
  hasMcpServers: boolean;
  variant?: "home" | "compact";
}> = ({
  onSelect,
  onTypeToChat,
  mode,
  setupComplete,
  hasExchange,
  hasBroker,
  hasWalletRails,
  variant = "home",
}) => {
  const options = useMemo(
    () => buildQuickStartRecommendedOptions({ mode, setupComplete, hasExchange, hasBroker, hasWalletRails }),
    [mode, setupComplete, hasExchange, hasBroker, hasWalletRails],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) setSelectedIndex((current) => (current - 1 + options.length) % options.length);
    else if (key.downArrow) setSelectedIndex((current) => (current + 1) % options.length);
    else if (key.return) onSelect(options[selectedIndex]!);
    else if (/^[1-9]$/u.test(input)) {
      const index = Number.parseInt(input, 10) - 1;
      const option = options[index];
      if (option) {
        setSelectedIndex(index);
        onSelect(option);
      }
    } else if (input === "/") {
      onTypeToChat("/");
    }
  });

  return (
    <Box flexGrow={1} justifyContent="center" alignItems="center">
      <Box width={variant === "home" ? 92 : 72}>
        <DeskPanel
          eyebrow="Home"
          title="Choose the next operating lane"
          subtitle="Home is a routing board, not the main desk."
          tone="brand"
        >
          {options.map((option, index) => {
            const active = index === selectedIndex;
            const copy = COPY[option];
            return (
              <Box
                key={option}
                borderStyle="single"
                borderColor={active ? COLORS.BRASS : COLORS.BRASS_DIM}
                paddingX={1}
                marginBottom={1}
              >
                <Text color={active ? COLORS.BRASS : COLORS.WHITE}>
                  {active ? ">" : " "} {index + 1}. {copy.title}
                  <Text color={COLORS.DIM}> · {copy.detail}</Text>
                </Text>
              </Box>
            );
          })}
          <Text color={COLORS.DIM}>Arrows move. Enter routes. Typing / opens the command path.</Text>
        </DeskPanel>
      </Box>
    </Box>
  );
};
