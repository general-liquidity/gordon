/**
 * Init Probe (GORDON_INIT_PROBE).
 *
 * Trading-domain port of the `init.sh` E2E health-check pattern from
 * Anthropic's "Effective harnesses for long-running agents" (2026).
 *
 * Goes deeper than `agentReadiness.ts` (B2): readiness just *checks*
 * that components exist; this probe *exercises* them end-to-end. The
 * model is "run a hello-world all the way through Gordon's runtime
 * before doing any feature work." If a probe fails, the operator gets
 * a concrete `fixInstruction` (red-pen pattern, L10) before the agent
 * burns a single tool call on the real task.
 *
 * Probes are caller-supplied. The module orchestrates them, captures
 * timing + error context, aggregates verdicts, and returns a structured
 * report. Pluggable probe design — the primitive stays decoupled from
 * any specific Gordon subsystem.
 *
 * Default probe families (suggested, not enforced):
 *   - venue connectivity   — open a market-data stream, get 1 candle
 *   - permission engine    — submit a synthetic plan, get a verdict
 *   - risk classifier      — verdict on a synthetic plan
 *   - termination layers   — verdict on synthetic inputs
 *   - safety files         — read/write each persistence path
 *   - kill-switch          — fire a no-op trigger and observe the halt path
 */

export type ProbeStatus = "pass" | "fail" | "skip";

export interface ProbeResult {
  status: ProbeStatus;
  message: string;
  /** Concrete next step when status==="fail". */
  fixInstruction?: string;
  /** Free-form observation fields. */
  observations?: Record<string, unknown>;
}

export interface Probe {
  id: string;
  /** Human-readable description; surfaced in the report. */
  description: string;
  /** Pass-only families this probe belongs to (informational). */
  family?: "venue" | "permission" | "risk" | "termination" | "state" | "kill-switch" | "other";
  /**
   * The actual check. Returns ProbeResult; throws are caught and converted
   * to status="fail" with the thrown error's message.
   */
  check: () => Promise<ProbeResult>;
}

export interface ProbeReport {
  capturedAt: string;
  totalCount: number;
  passingCount: number;
  failingCount: number;
  skippedCount: number;
  /** Total wall-clock time across all probes (ms). */
  durationMs: number;
  /** Each probe's verdict + timing. */
  results: Array<{
    id: string;
    description: string;
    family: string;
    status: ProbeStatus;
    message: string;
    fixInstruction?: string;
    durationMs: number;
    error?: string;
    observations?: Record<string, unknown>;
  }>;
  /** Aggregated fix instruction across all failing probes. */
  blockingFixInstruction: string | null;
  /** True iff zero probes failed (skipped probes are not failures). */
  ready: boolean;
}

export interface RunProbesOptions {
  /** Stop at the first failure rather than running all probes. */
  failFast?: boolean;
  /** Skip probes whose id appears here (returned as status="skip"). */
  skipIds?: readonly string[];
  /** Override clock for tests. */
  now?: () => string;
}

export async function runInitProbes(
  probes: readonly Probe[],
  opts: RunProbesOptions = {},
): Promise<ProbeReport> {
  const now = opts.now ?? (() => new Date().toISOString());
  const skipSet = new Set(opts.skipIds ?? []);
  const capturedAt = now();
  const start = Date.now();

  const results: ProbeReport["results"] = [];

  for (const probe of probes) {
    const probeStart = Date.now();
    let result: ProbeResult;
    let error: string | undefined;

    if (skipSet.has(probe.id)) {
      result = { status: "skip", message: "skipped by configuration" };
    } else {
      try {
        result = await probe.check();
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        result = {
          status: "fail",
          message: `probe threw: ${error}`,
          fixInstruction: `Investigate why probe "${probe.id}" threw. Stack: ${
            err instanceof Error && err.stack ? err.stack.split("\n")[0] : "unavailable"
          }.`,
        };
      }
    }

    results.push({
      id: probe.id,
      description: probe.description,
      family: probe.family ?? "other",
      status: result.status,
      message: result.message,
      fixInstruction: result.fixInstruction,
      durationMs: Date.now() - probeStart,
      error,
      observations: result.observations,
    });

    if (opts.failFast && result.status === "fail") break;
  }

  const passingCount = results.filter((r) => r.status === "pass").length;
  const failingCount = results.filter((r) => r.status === "fail").length;
  const skippedCount = results.filter((r) => r.status === "skip").length;

  const blockingFixInstruction =
    failingCount === 0
      ? null
      : results
          .filter((r) => r.status === "fail" && r.fixInstruction)
          .map((r) => `[${r.id}] ${r.fixInstruction}`)
          .join(" ");

  return {
    capturedAt,
    totalCount: results.length,
    passingCount,
    failingCount,
    skippedCount,
    durationMs: Date.now() - start,
    results,
    blockingFixInstruction,
    ready: failingCount === 0,
  };
}

export function formatProbeReport(report: ProbeReport): string {
  const lines: string[] = [];
  lines.push(
    `Init probe — ${report.passingCount}/${report.totalCount} pass, ${report.failingCount} fail, ${report.skippedCount} skip (${report.durationMs}ms)`,
  );
  for (const r of report.results) {
    const tag = r.status === "pass" ? "✓" : r.status === "skip" ? "·" : "✗";
    lines.push(`  ${tag} [${r.family}] ${r.id} — ${r.description} (${r.durationMs}ms)`);
    if (r.status === "fail") {
      lines.push(`      ${r.message}`);
      if (r.fixInstruction) lines.push(`      fix: ${r.fixInstruction}`);
    }
  }
  return lines.join("\n");
}

export function probeReportToPayload(report: ProbeReport): Record<string, unknown> {
  return {
    kind: "init_probe.report_recorded",
    ready: report.ready,
    passing: report.passingCount,
    failing: report.failingCount,
    skipped: report.skippedCount,
    durationMs: report.durationMs,
    blockingFixInstruction: report.blockingFixInstruction,
  };
}
