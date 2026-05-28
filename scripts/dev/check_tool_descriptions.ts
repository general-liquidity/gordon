#!/usr/bin/env bun
/**
 * check_tool_descriptions — score Mastra tool descriptions against the
 * Monigatti template (AI Engineer Europe 2026, "Agentic Search for Context
 * Engineering"). The article's argument: a one-line tool description is
 * the most common cause of "agent didn't call the right tool." This
 * script walks every `createTool({ ... })` in src/infra/agents/tools and
 * scores its description on four axes:
 *
 *   1. Length        — a description shorter than 80 chars is almost
 *                      always one-liner shorthand and scores 0.
 *   2. Trigger conds — does the description say WHEN to use the tool?
 *                      Phrases like "use when", "use this", "when to use",
 *                      "for ...", "if you need to ..." score 1.
 *   3. Relationships — does it cross-reference other tools / skills /
 *                      flows? Phrases like "see also", "before using",
 *                      "after the", "instead of", "vs", "or use" score 1.
 *   4. Examples      — does it include a concrete invocation example?
 *                      Triple-backticks, "example:", "e.g." score 1.
 *
 * Total max = 4. Ranks bottom-15 by total + length and prints them so
 * the operator can decide which to harden first. Use alongside the
 * /tool-friction-report skill: that skill flags which tools are hurting
 * in production; this script flags which descriptions are weakest at
 * rest. Tools that show up in BOTH lists are the highest-priority fix.
 *
 * Run:
 *   bun run scripts/dev/check_tool_descriptions.ts
 *
 * Exit codes:
 *   0  — always (informational only; this is a coach, not a gate)
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const TOOLS_ROOT = join(ROOT, "src", "infra", "agents", "tools");

interface ToolDescriptionFinding {
  filePath: string;
  toolId: string;
  description: string;
  lengthScore: number;
  triggerScore: number;
  relationshipScore: number;
  exampleScore: number;
  total: number;
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkTsFiles(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract (toolId, description) pairs from a file. Matches two shapes:
 *
 *   createTool({ id: "name", description: "...", ... })
 *   createTool({ id: "name", description: [ "line1", "line2", ... ].join("\n"), ... })
 *
 * The regex is intentionally loose — we accept some false positives so
 * we don't miss real tool definitions. The score is what the operator
 * acts on, not the listing itself.
 */
function extractToolDefinitions(source: string): Array<{ id: string; description: string }> {
  const out: Array<{ id: string; description: string }> = [];
  // Walk through every createTool({ ... }) block.
  const createToolPattern = /createTool\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  let match;
  while ((match = createToolPattern.exec(source)) !== null) {
    const block = match[1] ?? "";
    const idMatch = block.match(/\bid\s*:\s*["'`]([^"'`]+)["'`]/);
    if (!idMatch) continue;
    const id = idMatch[1]!;
    // String description.
    const strMatch = block.match(/\bdescription\s*:\s*(["'`])([\s\S]*?)\1\s*,/);
    if (strMatch) {
      out.push({ id, description: strMatch[2] ?? "" });
      continue;
    }
    // Array-joined description.
    const arrMatch = block.match(/\bdescription\s*:\s*\[([\s\S]*?)\]\s*\.\s*join\s*\(/);
    if (arrMatch) {
      // Concatenate the string literals inside the array (best-effort).
      const inner = arrMatch[1] ?? "";
      const parts: string[] = [];
      const partPattern = /["'`]([\s\S]*?)["'`]/g;
      let pm;
      while ((pm = partPattern.exec(inner)) !== null) parts.push(pm[1] ?? "");
      out.push({ id, description: parts.join("\n") });
    }
  }
  return out;
}

function scoreDescription(description: string): Omit<ToolDescriptionFinding, "filePath" | "toolId" | "description"> {
  const lower = description.toLowerCase();
  // 1. Length — 80 chars is the rough threshold between "tag line" and
  //    "actually explains the tool." Tools with longer descriptions
  //    almost always score better elsewhere too.
  const lengthScore = description.length >= 80 ? 1 : 0;
  // 2. Trigger conditions — WHEN to use the tool.
  const triggerPhrases = [
    "use when",
    "use this",
    "when to use",
    "when the",
    "if you need",
    "if the",
    "for use",
    "to be used",
    "call this",
    "invoke when",
    "trigger when",
  ];
  const triggerScore = triggerPhrases.some((p) => lower.includes(p)) ? 1 : 0;
  // 3. Relationships — cross-references to other tools / flows.
  const relationshipPhrases = [
    "see also",
    "before using",
    "after the",
    "after calling",
    "instead of",
    " vs ",
    " vs.",
    "or use",
    "pairs with",
    "complement",
    "related",
    "follow up",
    "follows the",
    "composes",
  ];
  const relationshipScore = relationshipPhrases.some((p) => lower.includes(p)) ? 1 : 0;
  // 4. Examples — concrete invocations.
  const exampleScore =
    description.includes("```") ||
    description.includes("example:") ||
    description.includes("Example:") ||
    description.includes("e.g.") ||
    description.includes("e.g ") ||
    description.includes("E.g.") ||
    /\b\w+\s*\(\s*\{/.test(description) // any inline call shape `tool({ ... })`
      ? 1
      : 0;
  const total = lengthScore + triggerScore + relationshipScore + exampleScore;
  return { lengthScore, triggerScore, relationshipScore, exampleScore, total };
}

function main(): void {
  if (!walkTsFiles(TOOLS_ROOT).length) {
    console.log(`No .ts files under ${TOOLS_ROOT} — nothing to audit.`);
    return;
  }
  const findings: ToolDescriptionFinding[] = [];
  for (const file of walkTsFiles(TOOLS_ROOT)) {
    let source: string;
    try {
      source = readFileSync(file, { encoding: "utf-8" });
    } catch {
      continue;
    }
    for (const { id, description } of extractToolDefinitions(source)) {
      const score = scoreDescription(description);
      findings.push({
        filePath: relative(ROOT, file),
        toolId: id,
        description,
        ...score,
      });
    }
  }
  if (findings.length === 0) {
    console.log("No createTool definitions found under src/infra/agents/tools.");
    return;
  }
  // Sort weakest first: by total ascending, then by length ascending.
  findings.sort((a, b) => a.total - b.total || a.description.length - b.description.length);

  const total = findings.length;
  const buckets: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const f of findings) buckets[f.total] = (buckets[f.total] ?? 0) + 1;
  console.log("Tool description audit");
  console.log("======================");
  console.log(`Scanned ${total} createTool definitions under src/infra/agents/tools.`);
  console.log(
    `Scores: 4/4 ${buckets[4]} · 3/4 ${buckets[3]} · 2/4 ${buckets[2]} · 1/4 ${buckets[1]} · 0/4 ${buckets[0]}`,
  );
  console.log("Axes: length≥80 | trigger conditions | relationships | example");
  console.log();
  const bottom = findings.slice(0, Math.min(15, findings.length));
  console.log(`Bottom ${bottom.length} (weakest first):`);
  for (const f of bottom) {
    console.log(
      `  [${f.total}/4] L${f.lengthScore} T${f.triggerScore} R${f.relationshipScore} E${f.exampleScore}  ${f.toolId}`,
    );
    const preview = f.description.replace(/\s+/g, " ").slice(0, 110);
    console.log(`         ${f.filePath}`);
    console.log(`         "${preview}${f.description.length > 110 ? "…" : ""}"`);
  }
  console.log();
  console.log(
    "Action: tools that also appear in `~/.gordon/tool-friction.jsonl` are the highest-priority fix —",
  );
  console.log("they have a weak description AND are hurting the agent in production.");
}

main();
