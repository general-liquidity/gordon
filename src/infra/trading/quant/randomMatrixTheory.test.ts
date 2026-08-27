import { describe, expect, test } from "bun:test";
import {
  countSignificantFactors,
  denoiseCovariance,
  marchenkoPasturBand,
} from "./randomMatrixTheory.ts";

describe("random matrix theory", () => {
  test("Marchenko-Pastur band is ordered", () => {
    const band = marchenkoPasturBand(4, 1);
    expect(band.lower).toBeCloseTo(0.25);
    expect(band.upper).toBeCloseTo(2.25);
  });

  test("counts only factors above the noise edge", () => {
    expect(countSignificantFactors([0.3, 1, 3], 4)).toBe(1);
  });

  test("denoising preserves a symmetric matrix shape", () => {
    const result = denoiseCovariance(
      [
        [1, 0.2],
        [0.2, 1],
      ],
      200,
    );
    expect(result).toHaveLength(2);
    expect(result[0]![1]).toBeCloseTo(result[1]![0]!);
  });
});
