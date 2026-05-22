#!/usr/bin/env bun
/**
 * One-shot script: backfill governance metadata on the bundled
 * SKILL.md files. Inserts `status: active` + `last-reviewed: <ISO>`
 * inside each frontmatter block, idempotent if either field already
 * exists.
 *
 * Run from repo root:
 *   bun run scripts/dev/tag-builtin-skills.ts [--date YYYY-MM-DD]
 *
 * Reuse the script when promoting community skills to the "active"
 * tier — pass `--dir <path>` to target a different skills root.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Options {
  skillsDir: string;
  date: string;
  status: "active" | "experimental" | "deprecated";
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    skillsDir: "src/infra/skills/builtin",
    date: new Date().toISOString().slice(0, 10),
    status: "active",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dir" && argv[i + 1]) opts.skillsDir = argv[++i]!;
    else if (arg === "--date" && argv[i + 1]) opts.date = argv[++i]!;
    else if (arg === "--status" && argv[i + 1]) opts.status = argv[++i]! as Options["status"];
  }
  return opts;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function tagSkill(filePath: string, opts: Options): "tagged" | "already-tagged" | "no-frontmatter" {
  const content = readFileSync(filePath, "utf-8");
  const match = content.match(FRONTMATTER_RE);
  if (!match) return "no-frontmatter";

  const fm = match[1]!;
  const hasStatus = /^status:\s/m.test(fm);
  const hasLastReviewed = /^last-reviewed:\s/m.test(fm);

  if (hasStatus && hasLastReviewed) return "already-tagged";

  let newFm = fm;
  if (!hasStatus) newFm += `\nstatus: ${opts.status}`;
  if (!hasLastReviewed) newFm += `\nlast-reviewed: ${opts.date}`;

  const newContent = content.replace(FRONTMATTER_RE, `---\n${newFm}\n---`);
  writeFileSync(filePath, newContent, "utf-8");
  return "tagged";
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dirs = readdirSync(opts.skillsDir).filter((d) => {
    try {
      return statSync(join(opts.skillsDir, d)).isDirectory();
    } catch {
      return false;
    }
  });

  const results = { tagged: [] as string[], alreadyTagged: [] as string[], noFrontmatter: [] as string[] };

  for (const dir of dirs) {
    const skillPath = join(opts.skillsDir, dir, "SKILL.md");
    try {
      statSync(skillPath);
    } catch {
      continue;
    }
    const verdict = tagSkill(skillPath, opts);
    if (verdict === "tagged") results.tagged.push(dir);
    else if (verdict === "already-tagged") results.alreadyTagged.push(dir);
    else results.noFrontmatter.push(dir);
  }

  console.log(`Skill tagging complete (status=${opts.status}, date=${opts.date}):`);
  console.log(`  Tagged:          ${results.tagged.length}`);
  console.log(`  Already tagged:  ${results.alreadyTagged.length}`);
  console.log(`  No frontmatter:  ${results.noFrontmatter.length}`);
  if (results.tagged.length > 0) console.log(`  Newly tagged: ${results.tagged.join(", ")}`);
  if (results.noFrontmatter.length > 0) console.log(`  Skipped (no frontmatter): ${results.noFrontmatter.join(", ")}`);
}

main();
