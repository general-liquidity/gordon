import { describe, expect, test } from "bun:test";

import {
  collapseToScalar,
  decomposeUncertainty,
  legsFromValues,
  recommendAction,
  sizeMultiplierFor,
  type EstimatorOpinion,
} from "./uncertainty-decomposition.ts";

/** Deterministic stand-in for a return series. No randomness anywhere in this suite. */
function series(count: number, amplitude: number, offset = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(offset + amplitude * Math.sin(i));
  return out;
}

function agreeing(count: number, value: number): EstimatorOpinion[] {
  const out: EstimatorOpinion[] = [];
  for (let i = 0; i < count; i++) out.push({ name: `est_${i}`, estimate: value });
  return out;
}

const CALM = series(40, 0.002);
const NOISY = series(40, 0.05);

describe("uncertainty decomposition", () => {
  test("the same total uncertainty demands opposite actions depending on its composition", () => {
    const noisyButKnown = legsFromValues({ aleatoric: 0.7, epistemic: 0.05, distributional: 0.05 });
    const quietButUnknown = legsFromValues({ aleatoric: 0.05, epistemic: 0.7, distributional: 0.05 });

    const totalA = collapseToScalar(noisyButKnown);
    const totalB = collapseToScalar(quietButUnknown);
    expect(totalA.value).not.toBeNull();
    expect(totalA.value).toBeCloseTo(totalB.value as number, 12);

    expect(recommendAction(noisyButKnown).action).toBe("size_down");
    expect(recommendAction(quietButUnknown).action).toBe("gather_evidence");

    expect(sizeMultiplierFor(noisyButKnown, "size_down")).toBeGreaterThan(0);
    expect(sizeMultiplierFor(quietButUnknown, "gather_evidence")).toBe(0);
  });

  test("a noisy market that is otherwise well understood is traded smaller, not skipped", () => {
    const result = decomposeUncertainty({
      observations: NOISY,
      estimators: agreeing(3, 0.001),
      familiarityScore: 0.8,
    });

    expect(result.legs.aleatoric.value).toBeGreaterThan(0.5);
    expect(result.legs.epistemic.value).toBeLessThan(0.2);
    expect(result.action).toBe("size_down");
    expect(result.sizeMultiplier).toBeGreaterThan(0);
    expect(result.sizeMultiplier).toBeLessThan(1);
  });

  test("estimators that disagree raise only the reducible leg", () => {
    const consensus = decomposeUncertainty({
      observations: NOISY,
      estimators: agreeing(3, 0.02),
      familiarityScore: 0.9,
    });
    const conflict = decomposeUncertainty({
      observations: NOISY,
      estimators: [
        { name: "trend", estimate: 0.005 },
        { name: "meanRev", estimate: 0.02 },
        { name: "carry", estimate: 0.035 },
      ],
      familiarityScore: 0.9,
    });

    expect(conflict.legs.epistemic.value as number).toBeGreaterThan(
      consensus.legs.epistemic.value as number,
    );
    expect(conflict.legs.aleatoric.value).toBe(consensus.legs.aleatoric.value);
  });

  test("corroborating evidence reduces what is knowable and leaves the market's own noise alone", () => {
    const thin = decomposeUncertainty({
      observations: NOISY,
      estimators: [
        { name: "trend", estimate: 0.005 },
        { name: "carry", estimate: 0.035 },
      ],
      familiarityScore: 0.9,
    });
    const corroborated = decomposeUncertainty({
      observations: NOISY,
      estimators: [
        { name: "trend", estimate: 0.005 },
        { name: "carry", estimate: 0.035 },
        ...agreeing(4, 0.02),
      ],
      familiarityScore: 0.9,
    });

    expect(corroborated.legs.epistemic.value as number).toBeLessThan(
      thin.legs.epistemic.value as number,
    );
    expect(corroborated.legs.aleatoric.value).toBe(thin.legs.aleatoric.value);
  });

  test("a state unlike anything in the reference set is skipped even when everything else looks clean", () => {
    const result = decomposeUncertainty({
      observations: CALM,
      estimators: agreeing(4, 0.01),
      familiarityScore: 0.02,
    });

    expect(result.legs.aleatoric.value as number).toBeLessThan(0.3);
    expect(result.legs.epistemic.value as number).toBeLessThan(0.3);
    expect(result.legs.distributional.value as number).toBeGreaterThan(0.9);
    expect(result.action).toBe("abstain");
    expect(result.sizeMultiplier).toBe(0);
  });

  test("four quiet observations are treated as not knowing, not as a calm market", () => {
    const result = decomposeUncertainty({
      observations: [0.0001, -0.0001, 0.0002, -0.0002],
      estimators: agreeing(3, 0.001),
      familiarityScore: 0.9,
    });

    expect(result.legs.aleatoric.status).toBe("unavailable");
    expect(result.legs.aleatoric.value).toBeNull();
    expect(result.legs.epistemic.value as number).toBeGreaterThan(0.5);
    expect(result.action).not.toBe("proceed");
  });

  test("unanimous estimators that are all wrong still report little epistemic uncertainty", () => {
    const result = decomposeUncertainty({
      observations: series(40, 0.002, -0.03),
      estimators: agreeing(4, 0.05),
      familiarityScore: 0.9,
    });

    expect(result.legs.epistemic.value as number).toBeLessThan(0.1);
    expect(result.action).toBe("proceed");
  });

  test("identical inputs always produce an identical result", () => {
    const evidence = {
      observations: NOISY,
      estimators: agreeing(3, 0.01),
      familiarityScore: 0.55,
    };
    const first = decomposeUncertainty(evidence);
    const second = decomposeUncertainty(evidence);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  describe("degenerate evidence", () => {
    test("an empty series reports the noise leg as unavailable instead of as zero", () => {
      const result = decomposeUncertainty({
        observations: [],
        estimators: agreeing(3, 0.01),
        familiarityScore: 0.9,
      });
      expect(result.legs.aleatoric.status).toBe("unavailable");
      expect(result.legs.aleatoric.value).toBeNull();
      expect(result.action).toBe("abstain");
      expect(result.sizeMultiplier).toBe(0);
    });

    test("a single estimator cannot show disagreement and is reported as unavailable", () => {
      const result = decomposeUncertainty({
        observations: NOISY,
        estimators: [{ name: "only", estimate: 0.01 }],
        familiarityScore: 0.9,
      });
      expect(result.legs.epistemic.status).toBe("unavailable");
      expect(result.action).not.toBe("proceed");
      expect(result.sizeMultiplier).toBe(0);
    });

    test("a perfectly flat series is a stalled feed, not a confident zero", () => {
      const result = decomposeUncertainty({
        observations: new Array(40).fill(0.001),
        estimators: agreeing(3, 0.001),
        familiarityScore: 0.9,
      });
      expect(result.legs.aleatoric.status).toBe("unavailable");
      expect(result.legs.aleatoric.value).toBeNull();
      expect(result.action).not.toBe("proceed");
    });

    test("a missing reference set leaves novelty unknown rather than assumed familiar", () => {
      const result = decomposeUncertainty({
        observations: CALM,
        estimators: agreeing(3, 0.001),
      });
      expect(result.legs.distributional.status).toBe("unavailable");
      expect(result.action).toBe("gather_evidence");
    });

    test("no total is offered while any leg is unmeasured", () => {
      const result = decomposeUncertainty({
        observations: [],
        estimators: [],
      });
      expect(result.total.value).toBeNull();
      expect(result.total.status).toBe("unavailable");
    });
  });

  test("a fully measured total still carries the warning that it is not the decision", () => {
    const total = collapseToScalar(
      legsFromValues({ aleatoric: 0.2, epistemic: 0.2, distributional: 0.2 }),
    );
    expect(total.status).toBe("measured");
    expect(total.value as number).toBeGreaterThan(0.2);
    expect(total.warning.length).toBeGreaterThan(0);
  });

  test("low uncertainty on every leg trades at close to full size", () => {
    const result = decomposeUncertainty({
      observations: CALM,
      estimators: agreeing(4, 0.004),
      familiarityScore: 0.95,
    });
    expect(result.action).toBe("proceed");
    expect(result.sizeMultiplier).toBeGreaterThan(0.8);
  });

  test("size shrinks with irreducible noise and ignores the reducible leg entirely", () => {
    const calmLegs = legsFromValues({ aleatoric: 0.1, epistemic: 0.1, distributional: 0.1 });
    const noisyLegs = legsFromValues({ aleatoric: 0.8, epistemic: 0.1, distributional: 0.1 });
    expect(sizeMultiplierFor(noisyLegs, "size_down")).toBeLessThan(
      sizeMultiplierFor(calmLegs, "proceed"),
    );

    const unknownLegs = legsFromValues({ aleatoric: 0.1, epistemic: 0.6, distributional: 0.1 });
    expect(recommendAction(unknownLegs).action).toBe("gather_evidence");
    expect(sizeMultiplierFor(unknownLegs, "gather_evidence")).toBe(0);
  });
});
