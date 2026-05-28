#!/usr/bin/env bun
/**
 * check_skill_staleness — flag built-in skills whose `last-reviewed` date has
 * gone stale, plus skills missing the field entirely.
 *
 * Lesson #15 from "21 painful mistakes building AI agents": agents decay if
 * you don't maintain them — run audits after tool / model / MCP / workflow
 * changes. A skill written against a tool surface that has since moved is a
 * silent landmine. This script makes skill decay visible the same way
 * check_tool_tiers makes tier drift visible and check_tool_descriptions makes
 * weak descriptions visible.
 *
 * Run:
 *   bun run scripts/dev/check_skill_staleness.ts            # default 90-day threshold
 *   bun run scripts/dev/check_skill_staleness.ts 30         # 30-day threshold
 *
 * Informational only — exit code is always 0. This is a coach, not a gate.
 * Feeds the /agent-health skill, which folds the stale list into a single
 * maintenance punch-list alongside the friction / feedback / eval queues.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKILLS_ROOT = join(ROOT, "src", "infra", "skills", "builtin");
const DEFAULT_THRESHOLD_DAYS = 90;
const DAY_MS = 86_400_000;

interface SkillRecord {
  filePath: string;
  name: string;
  lastReviewed: string | null;
  ageDays: number | null;
}

function findSkillFiles(dir: string, out: string[] = []): string[] {
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
      findSkillFiles(full, out);
    } else if (entry === "SKILL.md") {
      out.push(full);
    }
  }
  return out;
}

/** Extract a top-level frontmatter scalar (name / last-reviewed). Only reads
 *  the leading `--- ... ---` block. */
function frontmatterField(source: string, field: string): string | null {
  const fmMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const block = fmMatch ? fmMatch[1]! : source;
  const re = new RegExp(`^${field}\\s*:\\s*(.+?)\\s*$`, "mi");
  const m = block.match(re);
  if (!m) return null;
  // Strip surrounding quotes if present.
  return (m[1] ?? "").replace(/^["']|["']$/g, "").trim() || null;
}

function main(): void {
  const arg = process.argv[2];
  const thresholdDays =
    arg && Number.isFinite(Number(arg)) && Number(arg) > 0
      ? Math.floor(Number(arg))
      : DEFAULT_THRESHOLD_DAYS;

  const files = findSkillFiles(SKILLS_ROOT);
  if (files.length === 0) {
    console.log(`No SKILL.md files under ${relative(ROOT, SKILLS_ROOT)} — nothing to audit.`);
    return;
  }

  const now = Date.now();
  const records: SkillRecord[] = [];
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, { encoding: "utf-8" });
    } catch {
      continue;
    }
    const name = frontmatterField(source, "name") ?? relative(ROOT, file);
    const lastReviewed = frontmatterField(source, "last-reviewed");
    let ageDays: number | null = null;
    if (lastReviewed) {
      const parsed = Date.parse(lastReviewed);
      ageDays = Number.isFinite(parsed) ? Math.floor((now - parsed) / DAY_MS) : null;
    }
    records.push({ filePath: relative(ROOT, file), name, lastReviewed, ageDays });
  }

  const missing = records.filter((r) => r.lastReviewed === null || r.ageDays === null);
  const dated = records.filter((r) => r.ageDays !== null) as Array<SkillRecord & { ageDays: number }>;
  const stale = dated.filter((r) => r.ageDays > thresholdDays).sort((a, b) => b.ageDays - a.ageDays);
  const fresh = dated.length - stale.length;

  console.log("Skill staleness audit");
  console.log("=====================");
  console.log(`Scanned ${records.length} skills under ${relative(ROOT, SKILLS_ROOT)}.`);
  console.log(`Threshold: ${thresholdDays} days. Fresh: ${fresh} · Stale: ${stale.length} · Missing date: ${missing.length}`);
  console.log();

  if (stale.length > 0) {
    console.log(`Stale (last-reviewed > ${thresholdDays}d, oldest first):`);
    for (const r of stale) {
      console.log(`  [${r.ageDays}d]  ${r.name}  (reviewed ${r.lastReviewed})`);
      console.log(`         ${r.filePath}`);
    }
    console.log();
  }

  if (missing.length > 0) {
    console.log("Missing or unparseable last-reviewed (cannot assess decay):");
    for (const r of missing) {
      console.log(`  ${r.name}  —  ${r.filePath}${r.lastReviewed ? ` (unparseable: "${r.lastReviewed}")` : ""}`);
    }
    console.log();
  }

  if (stale.length === 0 && missing.length === 0) {
    console.log(`All ${records.length} skills reviewed within ${thresholdDays} days.`);
  } else {
    console.log(
      "Action: re-review stale skills against the current tool surface, then bump last-reviewed.",
    );
    console.log("Folded into the /agent-health maintenance punch-list alongside the friction queues.");
  }
}

main();
