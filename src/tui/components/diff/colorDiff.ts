// ============================================================================
// colorDiff — Simple line-based diff utility for Gordon CLI
// ============================================================================

export interface DiffLine {
  type: "added" | "removed" | "unchanged" | "header";
  content: string;
  lineNum?: number;
}

/**
 * Produces a line-by-line diff between two strings.
 * Uses a greedy LCS-style approach: walks through both line sets and marks
 * additions/removals/unchanged lines.
 */
export function parseDiff(before: string, after: string): DiffLine[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  const result: DiffLine[] = [];
  const maxLen = Math.max(beforeLines.length, afterLines.length);

  // Build a simple LCS table for alignment
  const lcs = computeLCS(beforeLines, afterLines);
  const merged = mergeDiff(beforeLines, afterLines, lcs);

  let lineNum = 1;
  for (const entry of merged) {
    if (entry.type === "unchanged") {
      result.push({ type: "unchanged", content: entry.content, lineNum });
      lineNum++;
    } else if (entry.type === "removed") {
      result.push({ type: "removed", content: entry.content, lineNum });
      lineNum++;
    } else if (entry.type === "added") {
      result.push({ type: "added", content: entry.content });
    }
  }

  void maxLen; // suppress unused warning
  return result;
}

/**
 * Returns the Ink color string for a given diff line type.
 */
export function getDiffColor(type: DiffLine["type"]): string {
  switch (type) {
    case "added":
      return "green";
    case "removed":
      return "red";
    case "header":
      return "gray";
    default:
      return "dimColor"; // special — callers should use `dimColor` prop
  }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

type MergedEntry = { type: "added" | "removed" | "unchanged"; content: string };

function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  return dp;
}

function mergeDiff(a: string[], b: string[], dp: number[][]): MergedEntry[] {
  const result: MergedEntry[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ type: "unchanged", content: a[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      result.push({ type: "added", content: b[j - 1]! });
      j--;
    } else {
      result.push({ type: "removed", content: a[i - 1]! });
      i--;
    }
  }

  return result.reverse();
}
