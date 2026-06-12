import { describe, expect, test } from "bun:test";

import { parseBootstrapArgs, formatDoctorReport, type DoctorReport } from "./setup-runtime.ts";

describe("setup runtime helpers", () => {
  test("parses bootstrap flags into structured options", () => {
    const parsed = parseBootstrapArgs([
      "--profile", "advanced",
      "--llm-provider", "dedalus",
      "--llm-key", "test-key",
      "--exchange", "binance",
      "--exchange-key", "key",
      "--exchange-secret", "secret",
      "--broker", "alpaca",
      "--broker-key", "broker-key",
      "--broker-secret", "broker-secret",
      "--broker-paper", "false",
      "--doctor",
    ]);

    expect(parsed.profile).toBe("advanced");
    expect(parsed.llmProvider).toBe("dedalus");
    expect(parsed.exchange).toBe("binance");
    expect(parsed.broker).toBe("alpaca");
    expect(parsed.brokerPaper).toBe(false);
    expect(parsed.runDoctor).toBe(true);
  });

  test("formats doctor report with checks and next actions", () => {
    const report: DoctorReport = {
      generatedAt: "2026-03-06T10:00:00.000Z",
      healthy: false,
      summary: {
        onboardingComplete: true,
        startupBannerMode: "full",
        llmReady: false,
        activeExchange: null,
        activeBroker: "alpaca",
        keyringEnabled: false,
        keyringAvailable: true,
        installedMcpPlugins: 2,
        enabledMcpPlugins: 1,
        structuredAxiomRequested: false,
        structuredAxiomEnabled: false,
        structuredAxiomConsentEnabled: false,
        structuredAxiomHashSaltConfigured: false,
        tracingEnabled: false,
        tracingRequested: false,
        tracingReviewed: false,
        tracingConsentEnabled: false,
      },
      checks: [
        { id: "llm", ok: false, severity: "error", message: "No LLM provider key is configured." },
      ],
      providerStatuses: [],
      nextActions: ["Run `gordon configure llm`."],
    };

    const formatted = formatDoctorReport(report);
    expect(formatted).toContain("Gordon Doctor");
    expect(formatted).toContain("No LLM provider key is configured.");
    expect(formatted).toContain("Run `gordon configure llm`.");
  });
});
