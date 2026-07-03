/**
 * Permission Mode Commands
 * Direct TUI handler for permission mode changes — bypasses the AI model.
 * These are config mutations, not queries; the model should never be called.
 */

import { loadConfig, saveConfig } from "../../infra/storage/config/config.ts";
import { setSandboxOverride } from "../../infra/runtime/sandboxOverride.ts";
import { ExchangeFactory } from "../../infra/exchange/factory.ts";
import { BrokerFactory } from "../../infra/broker/index.ts";
import {
  hasAcceptedLiveConsent,
  recordLiveConsent,
  LIVE_CONSENT_PROMPT,
} from "../../infra/safety/consent.ts";
import type { PermissionMode } from "../../tui/state/types.ts";

/**
 * Modes that can place LIVE orders. Arming one for the first time triggers the
 * one-time live-trading consent gate. Paper / strict / observe / plan can't
 * move real capital, so they are never gated.
 */
const LIVE_CAPABLE_MODES: ReadonlySet<PermissionMode> = new Set(["auto", "ask"]);

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
  opts?: { ackToken?: string },
): Promise<string> {
  // Live-arming consent gate: the first time the operator arms a live-capable
  // mode, require an explicit ARM acknowledgment of the disclaimer. Until then,
  // do NOT switch mode (fail safe). Once accepted it never prompts again.
  let consentJustRecorded = false;
  if (LIVE_CAPABLE_MODES.has(mode) && !hasAcceptedLiveConsent()) {
    if ((opts?.ackToken ?? "").trim().toUpperCase() === "ARM") {
      recordLiveConsent();
      consentJustRecorded = true;
    } else {
      return `${LIVE_CONSENT_PROMPT}\n\nLive trading not armed. Re-run this command with ARM to proceed (example: /${mode} ARM).`;
    }
  }

  const ackNote = consentJustRecorded
    ? "Live trading acknowledged (DISCLAIMER.md). "
    : "";

  const config = await loadConfig();
  const previous = config.permissionMode ?? "ask";

  if (previous === mode) {
    return `${ackNote}Already in '${mode}' mode.`;
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

  return `${ackNote}Permission mode → '${mode}'. ${MODE_DESCRIPTIONS[mode]}${sandboxNote}`;
}
