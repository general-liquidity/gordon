import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isCitationAgentEnabled,
  defaultCitationManifestPath,
  buildCitationManifest,
  detectUnsupportedClaims,
  findEvidenceForClaim,
  persistCitationManifest,
  readCitationManifests,
  formatCitationManifest,
  manifestToPayload,
  CITATION_AGENT_FLAG_ENV,
  CITATION_MANIFEST_PATH_ENV,
  type EvidenceRef,
} from "./citationAgent.ts";

let tempDir: string;
let manifestPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-citation-test-"));
  manifestPath = join(tempDir, "citations.jsonl");
});

const btcCandlesEv: EvidenceRef = {
  toolCallId: "call-1",
  toolName: "get_candles",
  resultFingerprint: "f1",
  summary: "BTC/USD 1h candles, last close 50000, RSI 22",
  timestamp: "2026-05-13T10:00:00.000Z",
  observations: { symbol: "BTC/USD", rsi: 22, close: 50000 },
};

const ethCandlesEv: EvidenceRef = {
  toolCallId: "call-2",
  toolName: "get_candles",
  resultFingerprint: "f2",
  summary: "ETH/USD 1h candles, last close 3000",
  timestamp: "2026-05-13T10:01:00.000Z",
  observations: { symbol: "ETH/USD", close: 3000 },
};

describe("isCitationAgentEnabled", () => {
  it("defaults on and respects the off-override", () => {
    expect(isCitationAgentEnabled({})).toBe(true);
    expect(isCitationAgentEnabled({ [CITATION_AGENT_FLAG_ENV]: "1" })).toBe(true);
    expect(isCitationAgentEnabled({ [CITATION_AGENT_FLAG_ENV]: "true" })).toBe(true);
    expect(isCitationAgentEnabled({ [CITATION_AGENT_FLAG_ENV]: "0" })).toBe(false);
    expect(isCitationAgentEnabled({ [CITATION_AGENT_FLAG_ENV]: "false" })).toBe(false);
  });
});

describe("defaultCitationManifestPath", () => {
  it("honors env override", () => {
    expect(defaultCitationManifestPath({ [CITATION_MANIFEST_PATH_ENV]: "/x.jsonl" })).toBe(
      "/x.jsonl",
    );
  });
  it("falls back to home-dir default", () => {
    expect(defaultCitationManifestPath({})).toContain("citation-manifests.jsonl");
  });
});

describe("findEvidenceForClaim — ticker match", () => {
  it("matches a BTC claim against BTC evidence (ticker overlap)", () => {
    const { refs, topScore } = findEvidenceForClaim("Long BTC/USD on oversold RSI", [
      btcCandlesEv,
      ethCandlesEv,
    ]);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs[0]!.toolCallId).toBe("call-1");
    expect(topScore).toBeGreaterThan(0.4);
  });

  it("matches ETH claim against ETH evidence", () => {
    const { refs } = findEvidenceForClaim("ETH/USD is consolidating", [btcCandlesEv, ethCandlesEv]);
    expect(refs[0]!.toolCallId).toBe("call-2");
  });
});

describe("findEvidenceForClaim — no match", () => {
  it("returns empty for irrelevant evidence", () => {
    const { refs } = findEvidenceForClaim("DOGE/USD looks weak on weekly chart", [
      btcCandlesEv,
      ethCandlesEv,
    ]);
    expect(refs).toEqual([]);
  });

  it("respects minScore threshold", () => {
    const weakEv: EvidenceRef = {
      toolCallId: "call-x",
      toolName: "get_news",
      resultFingerprint: "x",
      summary: "news about something",
      timestamp: "2026-05-13T10:00:00.000Z",
    };
    const { refs } = findEvidenceForClaim("Long BTC", [weakEv], { minScore: 0.5 });
    expect(refs).toEqual([]);
  });
});

describe("findEvidenceForClaim — indicator + number overlap", () => {
  it("matches when claim and evidence share an indicator name", () => {
    const { refs, topScore } = findEvidenceForClaim("RSI signals oversold", [btcCandlesEv]);
    expect(refs.length).toBe(1);
    expect(topScore).toBeGreaterThan(0);
  });

  it("matches when claim and evidence share a numeric value", () => {
    const { refs } = findEvidenceForClaim("Target 50000 on a bounce", [btcCandlesEv]);
    expect(refs.length).toBeGreaterThan(0);
  });
});

describe("findEvidenceForClaim — topK + ranking", () => {
  it("returns at most topK evidence refs", () => {
    const lots = Array.from({ length: 10 }, (_, i) => ({
      ...btcCandlesEv,
      toolCallId: `call-${i}`,
    }));
    const { refs } = findEvidenceForClaim("Long BTC/USD", lots, { topK: 3 });
    expect(refs.length).toBe(3);
  });
});

describe("buildCitationManifest", () => {
  it("builds a manifest with claim → evidence links", () => {
    const m = buildCitationManifest({
      recommendationId: "plan-1",
      claims: ["Long BTC/USD on RSI 22 oversold", "Take profit at 52000"],
      evidence: [btcCandlesEv, ethCandlesEv],
      now: "2026-05-13T10:30:00.000Z",
    });
    expect(m.citations.length).toBe(2);
    expect(m.citations[0]!.evidenceRefs.length).toBeGreaterThan(0);
    expect(m.recommendationId).toBe("plan-1");
    expect(m.createdAt).toBe("2026-05-13T10:30:00.000Z");
  });

  it("flags unsupported claims", () => {
    const m = buildCitationManifest({
      recommendationId: "plan-1",
      claims: [
        "Long BTC/USD on RSI 22", // supported
        "Solana validators are showing problems", // unsupported
      ],
      evidence: [btcCandlesEv],
    });
    expect(m.unsupportedClaimCount).toBe(1);
    expect(m.citations[1]!.unsupported).toBe(true);
  });

  it("computes supportRatio correctly", () => {
    const m = buildCitationManifest({
      recommendationId: "plan-1",
      claims: ["Long BTC/USD", "Random unsupported", "ETH/USD watch"],
      evidence: [btcCandlesEv, ethCandlesEv],
    });
    expect(m.supportRatio).toBeCloseTo(2 / 3);
  });

  it("supportRatio is 1 for empty claims", () => {
    const m = buildCitationManifest({
      recommendationId: "plan-1",
      claims: [],
      evidence: [],
    });
    expect(m.supportRatio).toBe(1);
  });

  it("totalEvidenceCount sums refs across citations", () => {
    const m = buildCitationManifest({
      recommendationId: "plan-1",
      claims: ["Long BTC", "BTC RSI 22"],
      evidence: [btcCandlesEv, { ...btcCandlesEv, toolCallId: "call-3" }],
    });
    expect(m.totalEvidenceCount).toBeGreaterThan(0);
  });
});

describe("detectUnsupportedClaims", () => {
  it("returns the unsupported claims only", () => {
    const m = buildCitationManifest({
      recommendationId: "p",
      claims: ["Long BTC/USD", "Cosmic alignment is bullish"],
      evidence: [btcCandlesEv],
    });
    const unsupported = detectUnsupportedClaims(m);
    expect(unsupported.length).toBe(1);
    expect(unsupported[0]!.claim).toContain("Cosmic");
  });
});

describe("persistCitationManifest / readCitationManifests", () => {
  it("round-trips through disk", () => {
    const m = buildCitationManifest({
      recommendationId: "p1",
      claims: ["Long BTC/USD"],
      evidence: [btcCandlesEv],
    });
    persistCitationManifest(m, manifestPath);
    expect(existsSync(manifestPath)).toBe(true);
    const out = readCitationManifests({}, manifestPath);
    expect(out.length).toBe(1);
    expect(out[0]!.recommendationId).toBe("p1");
  });

  it("filters by recommendationId", () => {
    persistCitationManifest(
      buildCitationManifest({ recommendationId: "p1", claims: ["x"], evidence: [] }),
      manifestPath,
    );
    persistCitationManifest(
      buildCitationManifest({ recommendationId: "p2", claims: ["y"], evidence: [] }),
      manifestPath,
    );
    expect(readCitationManifests({ recommendationId: "p1" }, manifestPath).length).toBe(1);
  });

  it("returns empty for missing file", () => {
    expect(readCitationManifests({}, join(tempDir, "no.jsonl"))).toEqual([]);
  });

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      persistCitationManifest(
        buildCitationManifest({
          recommendationId: `p${i}`,
          claims: [],
          evidence: [],
          now: `2026-05-1${i + 3}T00:00:00.000Z`,
        }),
        manifestPath,
      );
    }
    expect(readCitationManifests({ limit: 2 }, manifestPath).length).toBe(2);
  });

  it("returns newest-first", () => {
    persistCitationManifest(
      buildCitationManifest({
        recommendationId: "old",
        claims: [],
        evidence: [],
        now: "2026-01-01T00:00:00Z",
      }),
      manifestPath,
    );
    persistCitationManifest(
      buildCitationManifest({
        recommendationId: "new",
        claims: [],
        evidence: [],
        now: "2026-05-01T00:00:00Z",
      }),
      manifestPath,
    );
    const out = readCitationManifests({}, manifestPath);
    expect(out[0]!.recommendationId).toBe("new");
  });
});

describe("formatCitationManifest", () => {
  it("shows supported and unsupported with their evidence", () => {
    const m = buildCitationManifest({
      recommendationId: "p1",
      claims: ["Long BTC/USD on RSI 22", "Random nonsense claim"],
      evidence: [btcCandlesEv],
    });
    const out = formatCitationManifest(m);
    expect(out).toContain("UNSUPPORTED");
    expect(out).toContain("evidence");
    expect(out).toContain("get_candles");
  });
});

describe("manifestToPayload", () => {
  it("emits stable shape", () => {
    const m = buildCitationManifest({
      recommendationId: "p1",
      claims: ["Long BTC"],
      evidence: [btcCandlesEv],
    });
    const p = manifestToPayload(m);
    expect(p.kind).toBe("citation.manifest_recorded");
    expect(p.recommendationId).toBe("p1");
  });
});
