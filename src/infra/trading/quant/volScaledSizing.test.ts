import { describe, it, expect } from "bun:test";
import {
  isVolScaledSizingEnabled,
  computeVolScaledSizing,
  volScaledSizingToPayload,
  VOL_SCALED_SIZING_FLAG_ENV,
} from "./volScaledSizing.ts";

describe("isVolScaledSizingEnabled", () => {
  it("respects the flag", () => {
    expect(isVolScaledSizingEnabled({})).toBe(false);
    expect(isVolScaledSizingEnabled({ [VOL_SCALED_SIZING_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("computeVolScaledSizing — scale_down (default)", () => {
  it("calm vol → 1×, normal size", () => {
    const r = computeVolScaledSizing({ currentVol: 0.1 });
    expect(r.multiplier).toBe(1);
    expect(r.verdict).toBe("size_normal");
  });

  it("elevated vol → 0.66×, size_down", () => {
    const r = computeVolScaledSizing({ currentVol: 0.25 });
    expect(r.multiplier).toBe(0.66);
    expect(r.verdict).toBe("size_down");
  });

  it("high vol → 0.33×, size_down", () => {
    const r = computeVolScaledSizing({ currentVol: 0.4 });
    expect(r.multiplier).toBe(0.33);
    expect(r.verdict).toBe("size_down");
  });

  it("extreme vol ≥ refuseAbove → 0×, refuse", () => {
    const r = computeVolScaledSizing({ currentVol: 0.7 });
    expect(r.multiplier).toBe(0);
    expect(r.verdict).toBe("refuse");
  });
});

describe("computeVolScaledSizing — scale_up", () => {
  it("calm vol → 1×", () => {
    const r = computeVolScaledSizing({ currentVol: 0.1, mode: "scale_up" });
    expect(r.multiplier).toBe(1);
  });

  it("elevated vol → 2×, size_up", () => {
    const r = computeVolScaledSizing({ currentVol: 0.25, mode: "scale_up" });
    expect(r.multiplier).toBe(2);
    expect(r.verdict).toBe("size_up");
  });

  it("high vol → 3×, size_up", () => {
    const r = computeVolScaledSizing({ currentVol: 0.4, mode: "scale_up" });
    expect(r.multiplier).toBe(3);
  });

  it("extreme still refuses in scale_up mode", () => {
    const r = computeVolScaledSizing({ currentVol: 0.7, mode: "scale_up" });
    expect(r.verdict).toBe("refuse");
  });
});

describe("computeVolScaledSizing — custom bands", () => {
  it("custom band schema is respected", () => {
    const r = computeVolScaledSizing({
      currentVol: 0.18,
      bands: [
        { volAtLeast: 0, multiplier: 1, label: "default" },
        { volAtLeast: 0.15, multiplier: 0.5, label: "elevated" },
        { volAtLeast: 0.5, multiplier: 0, label: "refuse" },
      ],
    });
    expect(r.multiplier).toBe(0.5);
    expect(r.appliedBand.label).toBe("elevated");
  });
});

describe("computeVolScaledSizing — invalid inputs", () => {
  it("negative vol falls back to 1×", () => {
    const r = computeVolScaledSizing({ currentVol: -0.1 });
    expect(r.multiplier).toBe(1);
    expect(r.reasoning).toContain("invalid");
  });

  it("NaN vol falls back to 1×", () => {
    const r = computeVolScaledSizing({ currentVol: Number.NaN });
    expect(r.multiplier).toBe(1);
  });
});

describe("computeVolScaledSizing — custom thresholds", () => {
  it("respects lowVol/highVol overrides", () => {
    const r = computeVolScaledSizing({
      currentVol: 0.12,
      mode: "scale_down",
      lowVol: 0.1,
      highVol: 0.5,
    });
    // 0.12 ≥ 0.1 → elevated band, 0.66×.
    expect(r.multiplier).toBe(0.66);
  });
});

describe("volScaledSizingToPayload", () => {
  it("emits stable shape", () => {
    const r = computeVolScaledSizing({ currentVol: 0.25 });
    const p = volScaledSizingToPayload(r) as { kind: string; verdict: string };
    expect(p.kind).toBe("vol_scaled_sizing.computed");
    expect(["size_up", "size_normal", "size_down", "refuse"]).toContain(p.verdict);
  });
});
