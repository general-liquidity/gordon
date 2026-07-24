/**
 * One-line OpenTelemetry export status, shown by the /flags command.
 *
 * External telemetry export has been removed from this open-source build, so
 * this always reports "disabled (local only)". Kept as a stable seam so the
 * /flags command and prompt keep resolving.
 */
export function buildTracingStatusLine(): string {
  return "tracing: local only (external export disabled)";
}
