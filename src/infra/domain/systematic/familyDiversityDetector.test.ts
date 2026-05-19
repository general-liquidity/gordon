import { describe, it, expect } from "bun:test";
import {
  isFamilyDiversityDetectorEnabled,
  detectFamilyClustering,
  diversityHintToPayload,
  FAMILY_DIVERSITY_DETECTOR_FLAG_ENV,
} from "./familyDiversityDetector.ts";

describe("isFamilyDiversityDetectorEnabled", () => {
  it("respects the flag", () => {
    expect(isFamilyDiversityDetectorEnabled({})).toBe(false);
    expect(
      isFamilyDiversityDetectorEnabled({ [FAMILY_DIVERSITY_DETECTOR_FLAG_ENV]: "1" }),
    ).toBe(true);
  });
});

interface Exp {
  tags: string[];
}

function exp(tags: string[]): Exp {
  return { tags };
}

describe("detectFamilyClustering — empty / short input", () => {
  it("empty array → null", () => {
    expect(detectFamilyClustering([])).toBeNull();
  });

  it("fewer than window experiments → null", () => {
    const r = detectFamilyClustering([exp(["momentum"]), exp(["momentum"])], { window: 6 });
    expect(r).toBeNull();
  });
});

describe("detectFamilyClustering — cluster fires", () => {
  it("recent window dominated by one family → hint with that family", () => {
    const experiments = [
      exp(["mean-reversion"]),
      exp(["breakout"]),
      // last 6, all momentum
      exp(["momentum"]),
      exp(["momentum"]),
      exp(["momentum"]),
      exp(["momentum"]),
      exp(["momentum"]),
      exp(["momentum"]),
    ];
    const r = detectFamilyClustering(experiments);
    expect(r).not.toBeNull();
    expect(r!.dominantFamily).toBe("momentum");
    expect(r!.saturation).toBe(1);
    expect(r!.suggestedAlternatives).toContain("mean-reversion");
    expect(r!.suggestedAlternatives).toContain("breakout");
  });

  it("saturation just above threshold (5/6 in one family) → fires", () => {
    const experiments = [
      exp(["mean-reversion"]),
      exp(["mean-reversion"]),
      exp(["momentum"]),
      exp(["momentum"]),
      exp(["momentum"]),
      exp(["momentum"]),
      exp(["momentum"]),
      exp(["breakout"]),
    ];
    const r = detectFamilyClustering(experiments, { window: 6 });
    expect(r).not.toBeNull();
    expect(r!.dominantFamily).toBe("momentum");
    expect(r!.saturation).toBeCloseTo(5 / 6, 3);
  });
});

describe("detectFamilyClustering — cluster does NOT fire", () => {
  it("balanced families → null", () => {
    const experiments = [
      exp(["mean-reversion"]),
      exp(["momentum"]),
      exp(["breakout"]),
      exp(["vol-targeting"]),
      exp(["momentum"]),
      exp(["mean-reversion"]),
    ];
    const r = detectFamilyClustering(experiments);
    expect(r).toBeNull();
  });

  it("3/6 saturation below default 0.66 fraction → null", () => {
    const experiments = [
      exp(["momentum"]),
      exp(["momentum"]),
      exp(["momentum"]),
      exp(["mean-reversion"]),
      exp(["breakout"]),
      exp(["vol-targeting"]),
    ];
    const r = detectFamilyClustering(experiments);
    expect(r).toBeNull();
  });
});

describe("detectFamilyClustering — custom options", () => {
  it("custom window size", () => {
    const experiments = [
      exp(["mean-reversion"]),
      exp(["momentum"]),
      exp(["momentum"]),
    ];
    const r = detectFamilyClustering(experiments, { window: 3, clusterFraction: 0.5 });
    expect(r).not.toBeNull();
    expect(r!.dominantFamily).toBe("momentum");
  });

  it("custom familyOf extractor", () => {
    type Custom = { strategyFamily: string; tags?: string[] };
    const experiments: Custom[] = [
      { strategyFamily: "A", tags: [] },
      { strategyFamily: "A", tags: [] },
      { strategyFamily: "A", tags: [] },
      { strategyFamily: "A", tags: [] },
      { strategyFamily: "A", tags: [] },
      { strategyFamily: "B", tags: [] },
    ];
    const r = detectFamilyClustering(experiments, {
      familyOf: (e) => e.strategyFamily,
    });
    expect(r).not.toBeNull();
    expect(r!.dominantFamily).toBe("A");
  });
});

describe("detectFamilyClustering — case normalization", () => {
  it("default extractor lowercases family names", () => {
    const experiments = [
      exp(["Momentum"]),
      exp(["MOMENTUM"]),
      exp(["momentum"]),
      exp(["Momentum"]),
      exp(["mean-reversion"]),
      exp(["momentum"]),
    ];
    const r = detectFamilyClustering(experiments);
    expect(r).not.toBeNull();
    expect(r!.dominantFamily).toBe("momentum");
  });
});

describe("diversityHintToPayload", () => {
  it("emits no_cluster shape for null", () => {
    const p = diversityHintToPayload(null) as { kind: string };
    expect(p.kind).toBe("family_diversity.no_cluster");
  });

  it("emits cluster_detected shape for hint", () => {
    const experiments = [
      exp(["mean-reversion"]),
      exp(["momentum"]),
      exp(["momentum"]),
      exp(["momentum"]),
      exp(["momentum"]),
      exp(["momentum"]),
      exp(["momentum"]),
    ];
    const r = detectFamilyClustering(experiments);
    const p = diversityHintToPayload(r) as { kind: string; dominantFamily?: string };
    expect(p.kind).toBe("family_diversity.cluster_detected");
    expect(p.dominantFamily).toBe("momentum");
  });
});
