/**
 * Permission Mode Commands
 * Direct TUI handler for permission mode changes — bypasses the AI model.
 * These are config mutations, not queries; the model should never be called.
 */

import { loadConfig, saveConfig } from "../../infra/storage/config.ts";
import { setSandboxOverride } from "../../infra/runtime/sandboxOverride.ts";
import { ExchangeFactory } from "../../infra/exchange/factory.ts";
import { BrokerFactory } from "../../infra/broker/index.ts";
import type { PermissionMode } from "../../tui/state/types.ts";

const MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
  auto:    "Trades now execute without per-action approval.",
  ask:     "Each trade requires approval via dialog (default).",
  strict:  "Read-only mode. All trades blocked.",
  paper:   "Paper trading mode. Real orders blocked; simulated fills only.",
  observe: "Observation mode. No execution of any kind.",
  plan:    "Planning-only mode. Plans can be created but not executed.",
};

export async function handlePermissionModeCommand(
  mode: PermissionMode,
): Promise<string> {
  const config = await loadConfig();
  const previous = config.permissionMode ?? "ask";

  if (previous === mode) {
    return `Already in '${mode}' mode.`;
  }

  await saveConfig({ ...config, permissionMode: mode });

  // Sandbox override: paper → force sandbox, everything else → restore live
  const newOverride = mode === "paper" ? true : null;
  setSandboxOverride(newOverride);
  ExchangeFactory.clearCache();
  BrokerFactory.clearCache();

  // Bust gateway context resolver if running inside the daemon
  try {
    const { getGatewayContextResolver } = await import("../../gateway/runtime/context.ts");
    getGatewayContextResolver().invalidate();
  } catch {
    // Not running inside the gateway daemon — safe to ignore.
  }

  const sandboxNote =
    mode === "paper"   ? " Venue adapters switched to sandbox/testnet endpoints." :
    previous === "paper" ? " Venue adapters restored to live endpoints." : "";

  return `Permission mode → '${mode}'. ${MODE_DESCRIPTIONS[mode]}${sandboxNote}`;
}
