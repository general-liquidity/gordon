/**
 * Parse an EDGE.md markdown spec into a structured EdgeSpec.
 *
 * Format (mirrors the playbook parser — YAML-ish frontmatter, no external dep):
 *   ---
 *   name: ...
 *   strategy: <playbook-id>
 *   status: proposed | verified | live | retired
 *   regime: [ranging, chop]
 *   instruments: [BTC/USDT]
 *   ---
 *   ## Hypothesis
 *   <prose>
 *   ## Invariants
 *   | id | metric | comparator | threshold | description |
 *   ## Kill Conditions
 *   | id | metric | comparator | threshold | description |
 *   ## Verification
 *   <prose>
 */

import type { Comparator, EdgeInvariant, EdgeSpec, EdgeStatus } from "./types.ts";

const COMPARATORS = new Set<Comparator>([">", ">=", "<", "<=", "==", "!=", "in", "not-in"]);
const STATUSES: EdgeStatus[] = ["proposed", "verified", "live", "retired"];

function parseFrontmatter(raw: string): { meta: Record<string, string | string[]>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string | string[]> = {};
  for (const line of m[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      meta[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      meta[key] = val;
    }
  }
  return { meta, body: m[2] ?? "" };
}

/** Text of a `## Heading` section, up to the next `##` or end of body. */
function section(body: string, heading: string): string {
  const re = new RegExp(`(?:^|\\n)##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
  const m = body.match(re);
  return m ? m[1]!.trim() : "";
}

function parseThreshold(raw: string, comparator: Comparator): number | string | string[] {
  if (comparator === "in" || comparator === "not-in") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const n = Number(raw);
  return Number.isFinite(n) && raw.trim() !== "" ? n : raw.trim();
}

/** Parse a markdown table under `heading` into EdgeInvariant[].
 *  Columns: id | metric | comparator | threshold | description. */
function parseInvariantTable(body: string, heading: string): EdgeInvariant[] {
  const text = section(body, heading);
  if (!text) return [];
  const out: EdgeInvariant[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    const id = cells[0]!;
    // Skip the header row and the `|---|---|` separator row.
    if (id === "id" || /^:?-+:?$/.test(id)) continue;
    const comparator = cells[2] as Comparator;
    if (!COMPARATORS.has(comparator)) continue;
    out.push({
      id,
      metric: cells[1]!,
      comparator,
      threshold: parseThreshold(cells[3]!, comparator),
      description: cells[4] ?? "",
    });
  }
  return out;
}

export function parseEdgeSpec(markdown: string): EdgeSpec {
  const { meta, body } = parseFrontmatter(markdown);
  const asArray = (v: string | string[] | undefined): string[] =>
    Array.isArray(v) ? v : v ? [v] : [];
  const rawStatus = (meta.status as string) ?? "proposed";
  const status = (STATUSES as string[]).includes(rawStatus)
    ? (rawStatus as EdgeStatus)
    : "proposed";
  const verification = section(body, "Verification");
  return {
    name: (meta.name as string) ?? "unnamed-edge",
    strategy: (meta.strategy as string) ?? "",
    status,
    regime: asArray(meta.regime),
    instruments: asArray(meta.instruments),
    hypothesis: section(body, "Hypothesis"),
    invariants: parseInvariantTable(body, "Invariants"),
    killConditions: parseInvariantTable(body, "Kill Conditions"),
    ...(verification ? { verification } : {}),
  };
}
