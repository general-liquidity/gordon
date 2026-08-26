#!/usr/bin/env node
/**
 * Audit risk-tree — explain WHY the known-accepted-critical advisories
 * are in Gordon's dependency tree.
 *
 * The CI `bun audit` step silences three accepted transitive criticals
 * (protobufjs, form-data, shell-quote). This
 * script runs `bun why` for each affected package and emits a
 * top-N report showing which direct dependencies pull them in. The
 * point is to make the silenced advisories actionable: when an
 * upstream fix lands, you know exactly which top-level dep to bump.
 *
 * Run: `node scripts/dev/checks/audit-risk-tree.cjs`
 *
 * Inspired by Bun's `bun why` doc — uses the dependency-tree
 * explanation rather than a generic advisory dump.
 */

const { execFileSync } = require("node:child_process");
const path = require("node:path");

const ACCEPTED_ADVISORIES = [
  {
    id: "GHSA-xq3m-2v4x-88gg",
    pkg: "protobufjs",
    summary: "Arbitrary code execution",
    severity: "critical",
  },
  {
    id: "GHSA-fjxv-7rqg-78g4",
    pkg: "form-data",
    summary: "Unsafe random boundary",
    severity: "critical",
  },
  {
    id: "GHSA-w7jw-789q-3m8p",
    pkg: "shell-quote",
    summary: "Newline escape gap in quote() operator values",
    severity: "critical",
  },
];

const rootDir = path.resolve(__dirname, "..", "..", "..");
const bunBin = process.env.BUN_BIN?.trim() || "bun";

function tryBunWhy(pkg) {
  try {
    return execFileSync(bunBin, ["why", pkg, "--top"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (err) {
    if (err.code === "ENOENT" || /not found|not recognized/i.test(err.message ?? "")) {
      console.error(
        `audit-risk-tree: Bun executable ${JSON.stringify(bunBin)} was not found; ` +
          "set BUN_BIN to an absolute path.",
      );
      process.exit(1);
    }
    // bun why may exit non-zero when the package isn't installed
    return null;
  }
}

console.log("audit-risk-tree: explaining accepted-critical advisories in Gordon's tree.\n");
console.log("Pairs with .github/workflows/ci.yml `bun audit --ignore` flags.\n");
console.log("When an upstream fix lands, bump the named top-level dep to clear the entry.\n");
console.log("─".repeat(72));

for (const adv of ACCEPTED_ADVISORIES) {
  console.log(`\n${adv.severity.toUpperCase()}: ${adv.pkg}`);
  console.log(`  Advisory: ${adv.id}`);
  console.log(`  Summary: ${adv.summary}`);
  console.log(`  Why is it in the tree?`);

  const out = tryBunWhy(adv.pkg);
  if (!out) {
    console.log(`    (not installed or not findable — may have been removed; remove the --ignore in ci.yml if so)`);
    continue;
  }
  // Indent the bun why output two spaces under the package header
  const lines = out.trim().split("\n");
  for (const line of lines) {
    console.log(`    ${line}`);
  }
}

console.log("\n" + "─".repeat(72));
console.log("End of risk-tree report.");
console.log("If a dependency listed above has shipped a fix, bump it in package.json,");
console.log("re-run `bun install`, then remove the corresponding --ignore from ci.yml.");
