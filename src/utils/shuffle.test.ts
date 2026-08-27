import { describe, expect, it } from "bun:test";

import { shuffled } from "./shuffle.ts";

describe("shuffled", () => {
  it("uses Fisher-Yates and leaves its input unchanged", () => {
    const source = [0, 1, 2, 3];
    const draws = [0, 0.5, 0.75];
    let index = 0;

    expect(shuffled(source, () => draws[index++]!)).toEqual([3, 2, 1, 0]);
    expect(source).toEqual([0, 1, 2, 3]);
  });

  it("rejects a malformed RNG instead of generating an invalid index", () => {
    expect(() => shuffled([1, 2], () => 1)).toThrow("in [0, 1)");
  });
});
