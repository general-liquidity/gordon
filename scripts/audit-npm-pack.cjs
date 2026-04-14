#!/usr/bin/env node
/**
 * NPM Pack Audit
 *
 * Runs `npm pack --dry-run` from the npm/ wrapper directory and asserts the
 * file list contains ONLY the expected entries. Fails on:
 *   - any .ts/.tsx file (source code)
 *   - any .map file (source maps — the Claude Code leak vector)
 *   - any .env / credential file
 *   - any .git artifact
 *   - any test fixture or snapshot
 *   - anything outside the package.json `files` whitelist
 *
 * Run before every npm publish. CI also runs this before the publish step.
 */

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const NPM_DIR = path.resolve(__dirname, "..", "npm");

if (!fs.existsSync(NPM_DIR)) {
  console.error("[audit-npm-pack] npm/ directory not found");
  process.exit(2);
}

// Patterns that should NEVER appear in the published tarball
const FORBIDDEN_PATTERNS = [
  /\.tsx?$/i,           // TypeScript source
  /\.map$/i,            // source maps
  /\.env(\..*)?$/i,     // env files
  /\.gitignore$/i,
  /\.git\//,
  /credentials?/i,
  /\.key$/i,
  /\.pem$/i,
  /\.p12$/i,
  /test\//i,
  /tests\//i,
  /__tests__/i,
  /\.test\./i,
  /\.spec\./i,
  /\.snap$/i,
  /node_modules\//,
  /\.DS_Store$/,
  /Thumbs\.db$/,
];

// Patterns that are EXPECTED in the wrapper tarball
const EXPECTED_PATTERNS = [
  /^package\.json$/,
  /^README(\.md)?$/i,
  /^LICEN[CS]E(\.md)?$/i,
  /^bin\//,
  /^lib\//,
  /^scripts\//,
];

let output;
try {
  output = execSync("npm pack --dry-run --json", {
    cwd: NPM_DIR,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  console.error("[audit-npm-pack] npm pack --dry-run failed");
  console.error(err.stderr || err.message);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(output);
} catch (err) {
  console.error("[audit-npm-pack] failed to parse npm pack output");
  console.error(err.message);
  process.exit(1);
}

// npm pack --dry-run --json returns an array of package objects
const pkg = Array.isArray(parsed) ? parsed[0] : parsed;
if (!pkg || !pkg.files) {
  console.error("[audit-npm-pack] no files reported by npm pack");
  process.exit(1);
}

const fileList = pkg.files.map((f) => f.path);

const forbidden = [];
const unexpected = [];

for (const file of fileList) {
  // Check forbidden patterns
  let matchedForbidden = false;
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(file)) {
      forbidden.push({ file, pattern: pattern.source });
      matchedForbidden = true;
      break;
    }
  }
  if (matchedForbidden) continue;

  // Check expected patterns
  let matchedExpected = false;
  for (const pattern of EXPECTED_PATTERNS) {
    if (pattern.test(file)) {
      matchedExpected = true;
      break;
    }
  }
  if (!matchedExpected) {
    unexpected.push(file);
  }
}

console.log("");
console.log(`[audit-npm-pack] ${pkg.name}@${pkg.version}`);
console.log(`[audit-npm-pack] tarball: ${pkg.filename}`);
console.log(`[audit-npm-pack] ${fileList.length} files, ${pkg.unpackedSize} bytes unpacked`);
console.log("");

if (forbidden.length > 0) {
  console.error("┌──────────────────────────────────────────────────────────────────┐");
  console.error("│  NPM PACK AUDIT — FORBIDDEN FILES IN TARBALL                     │");
  console.error("└──────────────────────────────────────────────────────────────────┘");
  for (const { file, pattern } of forbidden) {
    console.error(`  ✗ ${file}  (matched /${pattern}/)`);
  }
  console.error("");
}

if (unexpected.length > 0) {
  console.warn("┌──────────────────────────────────────────────────────────────────┐");
  console.warn("│  NPM PACK AUDIT — UNEXPECTED FILES (review)                      │");
  console.warn("└──────────────────────────────────────────────────────────────────┘");
  for (const file of unexpected) {
    console.warn(`  ? ${file}`);
  }
  console.warn("");
  console.warn("If these files are intentional, update EXPECTED_PATTERNS in");
  console.warn("scripts/audit-npm-pack.cjs.");
  console.warn("");
}

if (forbidden.length > 0) {
  console.error(`[audit-npm-pack] FAIL: ${forbidden.length} forbidden file(s)`);
  process.exit(1);
}

console.log("[audit-npm-pack] ✓ all files within whitelist");
process.exit(0);
