import { describe, expect, it } from "bun:test";

import {
  auditNativeTransportUsage,
  buildTransportGuardCoverageReport,
} from "./transportGuardCoverage.ts";

describe("transport guard coverage", () => {
  it("finds no native HTTP/socket transports in trading transport surfaces", () => {
    const audit = auditNativeTransportUsage();
    expect(audit.scannedFiles).toBeGreaterThan(0);
    expect(audit.findings).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  it("requires installed fetch and filesystem guards for a clean coverage report", () => {
    const report = buildTransportGuardCoverageReport({
      fetchGuard: { enabled: true, installed: true },
      fsGuard: { enabled: true, installed: true },
    });

    expect(report.ok).toBe(true);
    expect(report.fetchGuardInstalled).toBe(true);
    expect(report.filesystemGuardInstalled).toBe(true);
    expect(report.summary).toContain("global outbound guard");
  });
});
