import { loadConfig, saveConfig } from "../../infra/storage/config.ts";
import {
  clearResearchData,
  disable,
  disableResearch,
  enable,
  enableResearch,
  getResearchStatus,
  getStatus,
  uploadResearchData,
} from "../../infra/telemetry/index.ts";

export interface TelemetryCommandResult {
  success: boolean;
  message: string;
}

function formatTelemetryStatus(): string {
  const status = getStatus();
  const research = getResearchStatus();
  const lines = [
    "**Telemetry Status**",
    "",
    `Anonymous telemetry: ${status.enabled ? "Enabled" : "Disabled"}`,
    `Environment override: ${status.envDisabled ? "Forced off" : "None"}`,
    `Queued events: ${status.queuedEvents}`,
    `Anonymous install ID: ${status.anonymousId.slice(0, 12)}...`,
    "",
    `Research data: ${research.enabled ? "Enabled" : "Disabled"}`,
  ];

  if (research.localFiles.length > 0) {
    lines.push(`Local research files: ${research.localFiles.length} (${research.totalSizeMb.toFixed(2)} MB)`);
    for (const file of research.localFiles) {
      lines.push(`  - ${file.name}: ${file.lines} record(s), ${file.sizeMb.toFixed(2)} MB`);
    }
  } else {
    lines.push("Local research files: none");
  }

  lines.push("");
  lines.push("Note: Gordon still stores local config, sessions, memory, and logs under ~/.gordon.");
  return lines.join("\n");
}

async function updateTelemetryConfig(
  update: (config: Awaited<ReturnType<typeof loadConfig>>) => void
): Promise<void> {
  const config = await loadConfig();
  update(config);
  await saveConfig(config);
}

export async function handleTelemetryCommand(args: string): Promise<TelemetryCommandResult> {
  const trimmed = args.trim();
  const normalized = trimmed.toLowerCase().replace(/\s+/g, "-");

  switch (normalized || "status") {
    case "status":
      return { success: true, message: formatTelemetryStatus() };
    case "enable":
      enable();
      await updateTelemetryConfig((config) => {
        config.telemetry.enabled = true;
      });
      return {
        success: true,
        message: `${formatTelemetryStatus()}\n\nAnonymous telemetry enabled.`,
      };
    case "disable":
      disable();
      await updateTelemetryConfig((config) => {
        config.telemetry.enabled = false;
      });
      return {
        success: true,
        message: `${formatTelemetryStatus()}\n\nAnonymous telemetry disabled.`,
      };
    case "research-enable":
      enableResearch();
      await updateTelemetryConfig((config) => {
        config.telemetry.researchData = true;
      });
      return {
        success: true,
        message: `${formatTelemetryStatus()}\n\nResearch data collection enabled.`,
      };
    case "research-disable":
      disableResearch();
      await updateTelemetryConfig((config) => {
        config.telemetry.researchData = false;
      });
      return {
        success: true,
        message: `${formatTelemetryStatus()}\n\nResearch data collection disabled.`,
      };
    case "research-status": {
      const research = getResearchStatus();
      const lines = [
        "**Research Data Status**",
        "",
        `Enabled: ${research.enabled ? "Yes" : "No"}`,
        `Total size: ${research.totalSizeMb.toFixed(2)} MB`,
      ];

      if (research.localFiles.length > 0) {
        lines.push("");
        for (const file of research.localFiles) {
          lines.push(`- ${file.name}: ${file.lines} record(s), ${file.sizeMb.toFixed(2)} MB`);
        }
      } else {
        lines.push("", "No local research data files present.");
      }

      return { success: true, message: lines.join("\n") };
    }
    case "research-upload": {
      const result = await uploadResearchData();
      return {
        success: true,
        message: `Uploaded ${result.uploaded} research record(s). Errors: ${result.errors}.`,
      };
    }
    case "research-clear": {
      const cleared = clearResearchData();
      return {
        success: true,
        message: `Cleared ${cleared} local research data file(s).`,
      };
    }
    default:
      return {
        success: false,
        message:
          "Unknown telemetry subcommand. Use `/telemetry [status|enable|disable|research-enable|research-disable|research-status|research-upload|research-clear]`.",
      };
  }
}
