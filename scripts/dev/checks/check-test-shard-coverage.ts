import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..", "..");
const workflowPath = resolve(repoRoot, ".github", "workflows", "release.yml");

function toRepoPath(path: string): string {
  return path.split(sep).join("/");
}

function collectTests(root: string): string[] {
  const absoluteRoot = resolve(repoRoot, root);
  const tests: string[] = [];

  for (const entry of readdirSync(absoluteRoot, { recursive: true })) {
    const absolute = resolve(absoluteRoot, String(entry));
    if (!absolute.endsWith(".test.ts") || !statSync(absolute).isFile()) continue;
    tests.push(toRepoPath(relative(repoRoot, absolute)));
  }

  return tests;
}

const workflow = readFileSync(workflowPath, "utf8");
const shardInputs = [...workflow.matchAll(/^\s+paths:\s+(.+)$/gm)].flatMap(
  (match) => match[1]?.trim().split(/\s+/) ?? [],
);

if (shardInputs.length === 0) {
  throw new Error("No release test-shard paths were found");
}

const allTests = [...collectTests("src"), ...collectTests("scripts")].sort();
const coverage = new Map(allTests.map((test) => [test, [] as string[]]));
const missingInputs: string[] = [];

for (const input of shardInputs) {
  const isTestFile = input.endsWith(".test.ts");
  const prefix = input.endsWith("/") ? input : `${input}/`;
  const matches = allTests.filter((test) =>
    isTestFile ? test === input : test.startsWith(prefix),
  );
  if (isTestFile && matches.length === 0) missingInputs.push(input);
  for (const test of matches) coverage.get(test)?.push(input);
}

const uncovered = [...coverage].filter(([, owners]) => owners.length === 0).map(([test]) => test);
const duplicated = [...coverage]
  .filter(([, owners]) => owners.length > 1)
  .map(([test, owners]) => `${test} <- ${owners.join(", ")}`);

if (uncovered.length || duplicated.length || missingInputs.length) {
  if (uncovered.length)
    console.error(`Uncovered tests (${uncovered.length}):\n${uncovered.join("\n")}`);
  if (duplicated.length)
    console.error(`Multiply covered tests (${duplicated.length}):\n${duplicated.join("\n")}`);
  if (missingInputs.length) {
    console.error(
      `Shard inputs matching no tests (${missingInputs.length}):\n${missingInputs.join("\n")}`,
    );
  }
  process.exit(1);
}

console.log(`Release shard coverage is exact: ${allTests.length} test files, one shard each.`);
