import * as fs from "node:fs";
import * as path from "node:path";

import { loadConfig, saveConfig } from "../../infra/storage/config/config.ts";
import { GORDON_DIR } from "../../infra/storage/paths.ts";
import {
  getStructuredAxiomPrivacyStatus,
  getStructuredAxiomStatus,
  getTracingConfig,
  getTracingStatus,
  initializeTracing,
  refreshStructuredAxiomState,
  shutdownTracing,
} from "../../infra/platform/observability/index.ts";
import {
  clearResearchData,
  disable,
  disableResearch,
  enable,
  enableResearch,
  getResearchStatus,
  getStatus,
  uploadResearchData,
} from "../../infra/platform/telemetry/index.ts";
import {
  sweepRetention,
  describeRetentionPolicy,
  getLastSweepResult,
} from "../../infra/platform/dataRetention.ts";

export interface TelemetryCommandResult {
  success: boolean;
  message: string;
}

function formatStructuredAxiomSummary(): string[] {
  const status = getStructuredAxiomStatus();
  const privacy = getStructuredAxiomPrivacyStatus();

  let summary = "Disabled";
  if (status.requested) {
    if (!status.consentEnabled) {
      summary = "Requested but blocked by telemetry consent";
    } else if (!status.configured) {
      summary = "Requested but missing Axiom token";
    } else if (!privacy.hashSaltConfigured) {
      summary = "Enabled (hash salt missing)";
    } else {
      summary = "Enabled";
    }
  }

  const lines = [
    `Structured Axiom: ${summary}`,
    `Axiom token: ${status.configured ? "Configured" : "Missing"}`,
    `Hash salt: ${privacy.hashSaltConfigured ? "Set" : "Missing"}`,
  ];

  if (status.eventsDataset && status.auditDataset) {
    lines.push(`Datasets: events=${status.eventsDataset}, audit=${status.auditDataset}`);
  }

  if (status.requested) {
    lines.push(`Queued structured events: ${status.queuedEvents}`);
    lines.push(`Queued audit events: ${status.queuedAudit}`);
  }

  return lines;
}

function formatTracingSummary(): string[] {
  const config = getTracingConfig();
  const status = getTracingStatus();

  let summary = "Disabled";
  if (config.requested) {
    if (!config.reviewed) {
      summary = "Requested but blocked by review gate";
    } else if (!config.consentEnabled) {
      summary = "Reviewed but blocked by telemetry consent";
    } else {
      summary = status.mastraWired ? "Enabled" : "Configured (Mastra trace export pending)";
    }
  }

  return [
    `OTEL tracing: ${summary}`,
    `Tracing review gate: ${config.reviewed ? "Acknowledged" : "Missing"}`,
    `Tracing runtime wired: ${status.mastraWired ? "Yes" : "No"}`,
  ];
}

function formatTelemetryStatus(): string {
  const status = getStatus();
  const research = getResearchStatus();
  const lines = [
    "**Telemetry Status**",
    "",
    `Anonymous telemetry: ${status.enabled ? "Enabled" : "Disabled"}`,
    `Environment override: ${status.envDisabled ? "Forced off" : "None"}`,
    `Queued anonymous events: ${status.queuedEvents}`,
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
  lines.push(...formatStructuredAxiomSummary());
  lines.push("");
  lines.push(...formatTracingSummary());
  lines.push("");
  if (status.envDisabled) {
    lines.push("Note: DO_NOT_TRACK/GORDON_TELEMETRY_DISABLED also blocks Axiom export and reviewed tracing that follow telemetry consent.");
  } else {
    lines.push("Note: Structured Axiom export and OTEL tracing follow the same telemetry consent when operator env enables them.");
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
      refreshStructuredAxiomState();
      await initializeTracing();
      return {
        success: true,
        message: `${formatTelemetryStatus()}\n\nTelemetry enabled. Structured Axiom export and reviewed OTEL tracing will now run if operator environment configuration is present.`,
      };
    case "disable":
      disable();
      await updateTelemetryConfig((config) => {
        config.telemetry.enabled = false;
      });
      refreshStructuredAxiomState({ clearQueueOnDisable: true });
      await shutdownTracing();
      return {
        success: true,
        message: `${formatTelemetryStatus()}\n\nTelemetry disabled. Anonymous telemetry stopped, structured Axiom export was blocked, and reviewed OTEL tracing was shut down for this install.`,
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
    case "export": {
      const result = await exportAllData();
      return result.success
        ? { success: true, message: `Exported ${result.bytes} bytes of data to ${result.filePath}` }
        : { success: false, message: result.error ?? "Export failed" };
    }
    case "forget": {
      const result = await forgetAllData();
      return {
        success: true,
        message: `Forgot ${result.filesDeleted} file(s) and reset anonymous ID. New ID: ${result.newAnonymousId.slice(0, 12)}...`,
      };
    }
    case "retention-status": {
      const last = getLastSweepResult();
      const lines = [
        "**Data Retention Policy**",
        "",
        describeRetentionPolicy(),
      ];
      if (last) {
        lines.push("");
        lines.push("**Last Sweep**");
        lines.push(`Started:        ${last.startedAt}`);
        lines.push(`Duration:       ${last.durationMs}ms`);
        lines.push(`Files deleted:  ${last.filesDeleted}`);
        lines.push(`Rows deleted:   ${last.rowsDeleted}`);
        lines.push(`Bytes reclaimed: ${last.bytesReclaimed}`);
        if (last.errors.length > 0) {
          lines.push(`Errors: ${last.errors.length}`);
          for (const err of last.errors) {
            lines.push(`  - ${err.where}: ${err.message}`);
          }
        }
      } else {
        lines.push("");
        lines.push("No sweep has run yet this session. Use /telemetry retention-sweep.");
      }
      return { success: true, message: lines.join("\n") };
    }
    case "retention-sweep": {
      const result = await sweepRetention();
      return {
        success: true,
        message: `Retention sweep complete. ${result.filesDeleted} files, ${result.rowsDeleted} rows, ${result.bytesReclaimed} bytes reclaimed in ${result.durationMs}ms.`,
      };
    }
    default:
      return {
        success: false,
        message:
          "Unknown telemetry subcommand. Use `/telemetry [status|enable|disable|research-enable|research-disable|research-status|research-upload|research-clear|export|forget|retention-status|retention-sweep]`.",
      };
  }
}

// ============================================================================
// Data Export & Forget
// ============================================================================

async function exportAllData(): Promise<{
  success: boolean;
  filePath?: string;
  bytes?: number;
  error?: string;
}> {
  try {
    const exportsDir = path.join(GORDON_DIR, "exports");
    fs.mkdirSync(exportsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(exportsDir, `gordon-data-export-${stamp}.json`);

    const payload: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      gordonDir: GORDON_DIR,
    };

    // Telemetry state
    const telemetryStateFile = path.join(GORDON_DIR, ".telemetry");
    if (fs.existsSync(telemetryStateFile)) {
      try {
        payload.telemetryState = JSON.parse(fs.readFileSync(telemetryStateFile, "utf-8"));
      } catch {
        payload.telemetryState = "<unreadable>";
      }
    }

    // Telemetry queued events
    const telemetryDir = path.join(GORDON_DIR, "telemetry");
    if (fs.existsSync(telemetryDir)) {
      const files: Record<string, unknown> = {};
      for (const name of fs.readdirSync(telemetryDir)) {
        try {
          files[name] = fs.readFileSync(path.join(telemetryDir, name), "utf-8");
        } catch {
          files[name] = "<unreadable>";
        }
      }
      payload.telemetryFiles = files;
    }

    // Research data
    const researchDir = path.join(GORDON_DIR, "research");
    if (fs.existsSync(researchDir)) {
      const files: Record<string, unknown> = {};
      for (const name of fs.readdirSync(researchDir)) {
        try {
          files[name] = fs.readFileSync(path.join(researchDir, name), "utf-8");
        } catch {
          files[name] = "<unreadable>";
        }
      }
      payload.researchFiles = files;
    }

    // Calibration journal
    const calibrationFile = path.join(GORDON_DIR, "calibration.jsonl");
    if (fs.existsSync(calibrationFile)) {
      try {
        payload.calibration = fs.readFileSync(calibrationFile, "utf-8");
      } catch {
        payload.calibration = "<unreadable>";
      }
    }

    // Experiment journal
    const experimentsFile = path.join(GORDON_DIR, "backtest-experiments.jsonl");
    if (fs.existsSync(experimentsFile)) {
      try {
        payload.experiments = fs.readFileSync(experimentsFile, "utf-8");
      } catch {
        payload.experiments = "<unreadable>";
      }
    }

    // Note about audit log
    payload.note = "Audit log is stored in SQLite (~/.gordon/gordon.db). To export it, query the audit_log table directly or use /telemetry retention-status to see retention policy.";

    const json = JSON.stringify(payload, null, 2);
    fs.writeFileSync(filePath, json, { mode: 0o600 });
    return { success: true, filePath, bytes: json.length };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function forgetAllData(): Promise<{
  filesDeleted: number;
  newAnonymousId: string;
}> {
  let filesDeleted = 0;

  // Delete telemetry queue files
  const telemetryDir = path.join(GORDON_DIR, "telemetry");
  if (fs.existsSync(telemetryDir)) {
    for (const name of fs.readdirSync(telemetryDir)) {
      try {
        fs.unlinkSync(path.join(telemetryDir, name));
        filesDeleted++;
      } catch {
        // skip
      }
    }
  }

  // Delete research data files
  const researchDir = path.join(GORDON_DIR, "research");
  if (fs.existsSync(researchDir)) {
    for (const name of fs.readdirSync(researchDir)) {
      try {
        fs.unlinkSync(path.join(researchDir, name));
        filesDeleted++;
      } catch {
        // skip
      }
    }
  }

  // Reset anonymous ID by overwriting the .telemetry state file
  const telemetryStateFile = path.join(GORDON_DIR, ".telemetry");
  const crypto = await import("node:crypto");
  const newAnonymousId = crypto.randomBytes(16).toString("hex");
  const newSalt = crypto.randomBytes(16).toString("hex");
  try {
    fs.writeFileSync(
      telemetryStateFile,
      JSON.stringify({ enabled: false, anonymousId: newAnonymousId, salt: newSalt, notifiedAt: null }, null, 2),
      "utf-8",
    );
  } catch {
    // Will be recreated on next telemetry call
  }

  return { filesDeleted, newAnonymousId };
}
