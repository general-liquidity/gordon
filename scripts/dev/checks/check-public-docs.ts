import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";

import { CANONICAL_ACTIONS } from "../../../src/infra/runtime/actions/registry.ts";

const repoRoot = resolve(import.meta.dir, "..", "..", "..");

const publicDocs = [
  "README.md",
  "docs/README.md",
  "docs/getting-started.md",
  "docs/why-gordon.md",
  "docs/capabilities.md",
  "docs/architecture.md",
  "docs/integrations.md",
  "docs/operations.md",
  "docs/security/README.md",
] as const;

const failures: string[] = [];

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function fail(path: string, message: string): void {
  failures.push(`${path}: ${message}`);
}

function markdownHeadings(source: string): Array<{ line: number; level: number; title: string }> {
  const headings: Array<{ line: number; level: number; title: string }> = [];
  let fenced = false;
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const markdown = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (markdown?.[1] && markdown[2]) {
      headings.push({ line: index + 1, level: markdown[1].length, title: markdown[2] });
    }
    const html = /^\s*<h([1-6])(?:\s[^>]*)?>(.*?)<\/h\1>\s*$/i.exec(line);
    if (html?.[1] && html[2]) {
      headings.push({ line: index + 1, level: Number(html[1]), title: html[2] });
    }
  }
  return headings;
}

function checkHeadings(path: string, source: string): void {
  const headings = markdownHeadings(source);
  const h1s = headings.filter((heading) => heading.level === 1);
  if (h1s.length !== 1) fail(path, `expected exactly one H1, found ${h1s.length}`);
  for (let index = 1; index < headings.length; index += 1) {
    const previous = headings[index - 1];
    const current = headings[index];
    if (previous && current && current.level > previous.level + 1) {
      fail(
        path,
        `heading level jumps from H${previous.level} on line ${previous.line} to H${current.level} on line ${current.line}`,
      );
    }
  }

  const lines = source.split(/\r?\n/);
  for (const [index, heading] of headings.entries()) {
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    const end = next ? next.line - 1 : lines.length;
    const body = lines
      .slice(heading.line, end)
      .filter((line) => !/^\s*<!--/.test(line))
      .some((line) => line.trim() !== "" && !/^#{1,6}\s/.test(line));
    if (!body) fail(path, `section "${heading.title}" on line ${heading.line} is empty`);
  }
}

function localTargets(source: string): string[] {
  const markdown = [...source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1] ?? "");
  const html = [...source.matchAll(/(?:href|src)=["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
  return [...markdown, ...html];
}

function headingAnchors(source: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const heading of markdownHeadings(source)) {
    const base = heading.title
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[`*_~]/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    const duplicate = seen.get(base) ?? 0;
    seen.set(base, duplicate + 1);
    anchors.add(duplicate === 0 ? base : `${base}-${duplicate}`);
  }
  return anchors;
}

function checkLinks(path: string, source: string): void {
  for (const rawTarget of localTargets(source)) {
    const target =
      rawTarget
        .trim()
        .replace(/^<|>$/g, "")
        .split(/\s+["']/)[0] ?? "";
    if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) {
      continue;
    }
    const [targetBeforeFragment, rawFragment] = target.split("#", 2);
    const filePart = decodeURIComponent(targetBeforeFragment?.split("?")[0] ?? "");
    const fragment = rawFragment ? decodeURIComponent(rawFragment).toLowerCase() : "";
    const absolute = filePart
      ? resolve(dirname(resolve(repoRoot, path)), filePart)
      : resolve(repoRoot, path);
    if (isAbsolute(filePart)) {
      fail(path, `public link must be repository-relative: ${rawTarget}`);
      continue;
    }
    const relativeToRoot = absolute.slice(repoRoot.length);
    if (relativeToRoot.startsWith("/../") || relativeToRoot === "/..") {
      fail(path, `local link escapes the repository: ${rawTarget}`);
    } else if (!existsSync(absolute)) {
      fail(path, `local link target does not exist: ${rawTarget}`);
    } else if (fragment && extname(absolute).toLowerCase() === ".md") {
      const anchors = headingAnchors(readFileSync(absolute, "utf8"));
      if (!anchors.has(fragment)) fail(path, `local heading target does not exist: ${rawTarget}`);
    }
  }
}

function checkGeneratedActions(): void {
  const generatedPath = "docs/generated/actions.json";
  const generated = JSON.parse(readRepoFile(generatedPath)) as Array<{
    id?: string;
    title?: string;
    description?: string;
    approvalPolicy?: string;
  }>;
  const byId = new Map(generated.map((action) => [action.id, action]));
  const expectedIds = CANONICAL_ACTIONS.map((action) => action.id).sort();
  const generatedIds = generated.map((action) => action.id ?? "").sort();
  if (JSON.stringify(generatedIds) !== JSON.stringify(expectedIds)) {
    fail(
      generatedPath,
      "action IDs differ from the runtime registry; run bun run generate:actions-docs",
    );
  }
  for (const action of CANONICAL_ACTIONS) {
    const record = byId.get(action.id);
    if (!record) continue;
    for (const field of ["title", "description", "approvalPolicy"] as const) {
      if (record[field] !== action[field]) {
        fail(generatedPath, `${action.id}.${field} differs from the runtime registry`);
      }
    }
  }

  const markdownIds = [
    ...readRepoFile("docs/generated/actions.md").matchAll(/^### `([^`]+)`$/gm),
  ].map((match) => match[1] ?? "");
  if (JSON.stringify(markdownIds.sort()) !== JSON.stringify(expectedIds)) {
    fail(
      "docs/generated/actions.md",
      "action headings differ from the runtime registry; run bun run generate:actions-docs",
    );
  }
}

function stringArray(source: string, declaration: string): string[] {
  const escaped = declaration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`).exec(source);
  if (!match?.[1]) throw new Error(`Could not find array ${declaration}`);
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1] ?? "");
}

function countRiskDimensions(): number {
  const source = readRepoFile("src/infra/trading/risk/riskClassifier.ts");
  const body = source
    .split("export function classifyTradeRisk(")[1]
    ?.split("// Compute weighted composite")[0];
  if (!body) throw new Error("Could not isolate classifyTradeRisk");
  const names = new Set(
    [...body.matchAll(/name:\s*["']([^"']+)["']/g)].map((match) => match[1] ?? ""),
  );
  const uncertainty = /const UNCERTAINTY_DIMENSION_NAME\s*=\s*["']([^"']+)["']/.exec(source)?.[1];
  if (!uncertainty) throw new Error("Could not find UNCERTAINTY_DIMENSION_NAME");
  names.add(uncertainty);
  return names.size;
}

function countCanonicalTools(): number {
  const files = ["data.ts", "analytics.ts", "plan.ts", "memory.ts", "workflow.ts"];
  const ids = new Set<string>();
  for (const file of files) {
    const source = readRepoFile(`src/infra/agents/tools/surface/${file}`);
    for (const match of source.matchAll(/^\s+id:\s*["']([^"']+)["']/gm)) {
      if (match[1]) ids.add(match[1]);
    }
  }
  return ids.size;
}

function countProducers(): number {
  const source = readRepoFile("src/infra/proactive/producers/index.ts");
  return new Set(
    [...source.matchAll(/registerProducer\(withHealthTracking\(["']([^"']+)["']/g)].map(
      (match) => match[1] ?? "",
    ),
  ).size;
}

function requireText(path: string, expected: string): void {
  if (!readRepoFile(path).includes(expected)) fail(path, `missing source-bound text: ${expected}`);
}

function rejectConflictingCounts(
  path: string,
  pattern: RegExp,
  expected: number,
  label: string,
): void {
  for (const match of readRepoFile(path).matchAll(pattern)) {
    const declared = Number(match[1]);
    if (declared !== expected) {
      fail(path, `declares ${declared} ${label}; source currently defines ${expected}`);
    }
  }
}

for (const path of publicDocs) {
  const source = readRepoFile(path);
  if (source.includes("—")) fail(path, "contains an em dash");
  checkHeadings(path, source);
  checkLinks(path, source);
}

checkGeneratedActions();

const packageJson = JSON.parse(readRepoFile("package.json")) as { description?: string };
const wrapperPackageJson = JSON.parse(readRepoFile("npm/package.json")) as { description?: string };
if (!packageJson.description || packageJson.description !== wrapperPackageJson.description) {
  fail("package.json", "root and npm wrapper descriptions differ");
} else {
  requireText("README.md", packageJson.description);
}

const riskDimensions = countRiskDimensions();
const canonicalTools = countCanonicalTools();
const indicators = stringArray(
  readRepoFile("src/infra/agents/tools/surface/analytics.ts"),
  "const INDICATOR_NAMES",
).length;
const advancedOperations = stringArray(
  readRepoFile("src/infra/agents/tools/surface/analytics.ts"),
  "const MICROSTRUCTURE_OPS",
).length;
const hooks = stringArray(
  readRepoFile("src/infra/hooks/types.ts"),
  "export const HOOK_POINTS",
).length;
const exchanges = stringArray(
  readRepoFile("src/infra/exchange/types.ts"),
  "export const EXCHANGE_IDS",
).length;
const producers = countProducers();

for (const path of publicDocs) {
  rejectConflictingCounts(
    path,
    /(\d+)-dimension risk classifi(?:er|cation)/g,
    riskDimensions,
    "risk dimensions",
  );
  rejectConflictingCounts(path, /(\d+)-tool surface/g, canonicalTools, "canonical tools");
  rejectConflictingCounts(path, /(\d+) indicator operations/g, indicators, "indicator operations");
  rejectConflictingCounts(
    path,
    /(\d+) advanced-analysis operations/g,
    advancedOperations,
    "advanced-analysis operations",
  );
  rejectConflictingCounts(path, /(\d+) proactive radar producers/g, producers, "radar producers");
  rejectConflictingCounts(path, /(\d+) lifecycle points/g, hooks, "lifecycle hooks");
  rejectConflictingCounts(
    path,
    /(\d+) first-class venue identifiers/g,
    exchanges,
    "first-class exchanges",
  );
}

for (const path of ["README.md", "docs/architecture.md", "docs/security/README.md"]) {
  requireText(path, `${riskDimensions}-dimension`);
}
for (const path of ["README.md", "docs/architecture.md"]) {
  requireText(path, `${canonicalTools}-tool`);
}
for (const path of ["README.md", "docs/capabilities.md"]) {
  requireText(path, `${indicators} indicator`);
  requireText(path, `${advancedOperations} advanced-analysis`);
}
requireText("README.md", `${hooks} lifecycle`);
requireText("README.md", `${producers} proactive`);
requireText("docs/integrations.md", `${exchanges} first-class`);

if (failures.length > 0) {
  console.error(`Public documentation check failed (${failures.length}):\n${failures.join("\n")}`);
  process.exit(1);
}

console.log(
  `Public documentation is coherent: ${publicDocs.length} documents; ${riskDimensions} risk dimensions; ${canonicalTools} canonical tools; ${indicators} indicator operations; ${advancedOperations} advanced-analysis operations; ${producers} radar producers; ${hooks} hooks; ${exchanges} first-class exchanges.`,
);
