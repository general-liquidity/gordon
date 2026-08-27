/** Return a Fisher-Yates permutation without mutating the input. */
export function shuffled<T>(values: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const draw = rng();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
      throw new RangeError(`shuffle RNG must return a finite value in [0, 1); got ${draw}`);
    }
    const j = Math.floor(draw * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
