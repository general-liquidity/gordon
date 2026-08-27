import type { PermissionMode } from "../../types/index.ts";

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
  | "strategies-live"
  | "regime"
  | "chains";

export function buildQuickStartRecommendedOptions(input: {
  permissionMode: PermissionMode;
  setupComplete: boolean;
  hasExchange: boolean;
  hasBroker: boolean;
}): MenuOption[] {
  if (!input.setupComplete || (!input.hasExchange && !input.hasBroker)) {
    return ["chat", "setup", "doctor", "help", "scan", "portfolio"];
  }
  if (input.permissionMode === "auto") {
    return ["chat", "scan", "orders", "positions", "preview-order", "plan"];
  }
  return ["chat", "scan", "portfolio", "plan", "orders", "strategies-live"];
}
