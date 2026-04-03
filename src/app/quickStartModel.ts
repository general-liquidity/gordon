import type { Mode } from "../types/index.ts";

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
