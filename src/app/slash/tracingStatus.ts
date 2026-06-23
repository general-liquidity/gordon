import {
  getTracingStatus,
  resolveExporterTarget,
} from "../../infra/platform/observability/tracing.ts";

/**
 * One-line OpenTelemetry export status, shown by the /flags command.
 * `resolveExporterTarget().target` is the configured endpoint; `enabled` comes
 * from `getTracingStatus()` (false until tracing is initialized).
 */
export function buildTracingStatusLine(): string {
  const { target } = resolveExporterTarget();
  const enabled = getTracingStatus().enabled;
  return `tracing: ${target} (${enabled ? "enabled" : "disabled"})`;
}
