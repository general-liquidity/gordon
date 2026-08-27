export interface FuzzyResult {
  score: number;
}

const WORD_START = /[\s/_:.-]/;

/**
 * Case-insensitive fuzzy matcher for command-palette style labels.
 * Higher score is better; null means the query characters cannot be matched.
 */
export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const q = query.trim().toLowerCase();
  const target = text.toLowerCase();
  if (q.length === 0) return { score: 0 };
  if (target.length === 0) return null;

  if (target === q) {
    return { score: 400 - text.length / 1000 };
  }

  const substringIndex = target.indexOf(q);
  if (substringIndex !== -1) {
    const prefixBonus = substringIndex === 0 ? 40 : 0;
    const boundaryBonus =
      substringIndex > 0 && WORD_START.test(target[substringIndex - 1] ?? "") ? 20 : 0;
    return { score: 300 + prefixBonus + boundaryBonus - substringIndex - text.length / 1000 };
  }

  const wordStartScore = scoreWordStartSubsequence(q, target);
  if (wordStartScore !== null) {
    return { score: wordStartScore - text.length / 1000 };
  }

  const scatteredScore = scoreScatteredSubsequence(q, target);
  if (scatteredScore !== null) {
    return { score: scatteredScore - text.length / 1000 };
  }

  return null;
}

function scoreWordStartSubsequence(query: string, target: string): number | null {
  let qi = 0;
  for (let i = 0; i < target.length && qi < query.length; i++) {
    const isStart = i === 0 || WORD_START.test(target[i - 1] ?? "");
    if (isStart && target[i] === query[qi]) qi++;
  }
  if (qi !== query.length) return null;
  return 100 + query.length * 8;
}

function scoreScatteredSubsequence(query: string, target: string): number | null {
  let qi = 0;
  let first = -1;
  let last = -1;

  for (let i = 0; i < target.length && qi < query.length; i++) {
    if (target[i] !== query[qi]) continue;
    if (first === -1) first = i;
    last = i;
    qi++;
  }

  if (qi !== query.length || first === -1) return null;
  const span = Math.max(1, last - first + 1);
  return 1 + query.length * 4 + Math.max(0, 20 - span);
}
