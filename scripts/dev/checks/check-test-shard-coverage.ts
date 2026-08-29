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

/**
 * Which shard owns each path, so the mock quarantine can be checked.
 *
 * `mocked` and `state`/`state-extra` are split because `mock.module` is
 * process-wide: a mock installed by one suite reaches every later suite in the
 * same shard, and which suite runs first depends on module-eval order, which
 * differs per platform. That is why v0.5.0 passed on Windows and failed on
 * Linux CI at tag time. Assignment alone was checked here before, so a file
 * placed in the wrong shard by name rather than by behavior was invisible.
 */
const shardOf = new Map<string, string>();
{
  let current: string | null = null;
  for (const line of workflow.split("\n")) {
    const name = /^\s+-\s+shard-name:\s+(\S+)/.exec(line);
    if (name?.[1]) current = name[1];
    const paths = /^\s+paths:\s+(.+)$/.exec(line);
    if (paths?.[1] && current) {
      for (const p of paths[1].trim().split(/\s+/)) shardOf.set(p, current);
    }
  }
}

const MOCK_SHARD = "mocked";
const REAL_STORE_SHARDS = new Set(["state", "state-extra"]);
const mockPlacement: string[] = [];

for (const [input, shard] of shardOf) {
  if (!input.endsWith(".test.ts")) continue;
  if (shard !== MOCK_SHARD && !REAL_STORE_SHARDS.has(shard)) continue;
  let body: string;
  try {
    body = readFileSync(resolve(repoRoot, input), "utf8");
  } catch {
    continue; // a path matching no file is already reported as a missing input
  }
  const mocks = body.includes("mock.module");
  if (mocks && REAL_STORE_SHARDS.has(shard)) {
    mockPlacement.push(
      `${input} calls mock.module but sits in '${shard}', where suites use the real store`,
    );
  }
  if (!mocks && shard === MOCK_SHARD) {
    mockPlacement.push(
      `${input} calls no mock.module but sits in '${shard}', so other suites' mocks reach it`,
    );
  }
}

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

if (uncovered.length || duplicated.length || missingInputs.length || mockPlacement.length) {
  if (mockPlacement.length)
    console.error(
      `Test files in the wrong mock shard (${mockPlacement.length}):\n${mockPlacement.join("\n")}`,
    );
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
