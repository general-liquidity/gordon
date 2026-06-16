/**
 * Read-only status helpers for the Model to Market competition surfaces.
 *
 * Kept in a leaf module (no slash-command imports) so both `slashCommands.ts`
 * and `commandPrompts.ts` can use them without a circular import — slashCommands
 * re-exports `commandToPrompt` from commandPrompts, so the builders can't live in
 * either of those files.
 */

import { COMPETITION_RISK_AGGRESSIVE } from "../../core/risk-management/competition-risk-preset.ts";
import { getTracingStatus, resolveExporterTarget } from "../../infra/platform/observability/tracing.ts";

/**
 * One-line OpenTelemetry export status. `resolveExporterTarget().target` is the
 * resolved OTLP backend ("logfire" | "axiom" | "custom"); the enabled flag comes
 * from `getTracingStatus()` (false until tracing is initialized).
 */
export function buildTracingStatusLine(): string {
  const { target } = resolveExporterTarget();
  const enabled = getTracingStatus().enabled;
  return `tracing: ${target} (${enabled ? "enabled" : "disabled"})`;
}

/**
 * Read-only competition status panel for the "Model to Market" hack. Prints the
 * aggressive risk posture, env readiness as present/absent booleans (never the
 * secret values), the tracing target, and the bring-up checklist.
 */
export function buildMomqStatusPanel(): string {
  const p = COMPETITION_RISK_AGGRESSIVE;
  const present = (name: string): string =>
    (process.env[name] ?? "").trim().length > 0 ? "present" : "absent";

  const lines = [
    "Model to Market — competition status (read-only)",
    "",
    "Risk posture (COMPETITION_RISK_AGGRESSIVE):",
    `  maxLeverage:               ${p.maxLeverage}x`,
    `  maxRiskPerTradePct:        ${(p.maxRiskPerTradePct * 100).toFixed(2)}%`,
    `  dailyLossKillPct:          ${(p.dailyLossKillPct * 100).toFixed(1)}%`,
    `  maxConcurrentExposurePct:  ${(p.maxConcurrentExposurePct * 100).toFixed(0)}% gross`,
    "",
    "Environment readiness:",
    `  DOUBLEWORD_API_KEY:        ${present("DOUBLEWORD_API_KEY")}`,
    `  LOGFIRE_TOKEN:             ${present("LOGFIRE_TOKEN")}`,
    `  ${buildTracingStatusLine()}`,
    "",
    "Checklist:",
    "  1. Start the MT5 bridge:  scripts/mt5-bridge/mt5_bridge.py",
    "  2. Verify the bridge:     bun run scripts/dev/mt5-smoke.ts",
    "  3. Set DOUBLEWORD_API_KEY + LOGFIRE_TOKEN in .env",
  ];
  return lines.join("\n");
}
