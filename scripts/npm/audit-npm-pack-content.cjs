#!/usr/bin/env node
/**
 * Pre-publish sensitive-content scanner for the npm wrapper.
 *
 * npm's publishing guidance explicitly warns: "Publishing sensitive
 * information to the registry can harm your users, compromise your
 * development infrastructure, be expensive to fix, and put you at
 * risk of legal action." This script greps every would-be-published
 * file for known credential patterns (npm tokens, GitHub PATs, AWS
 * access keys, Stripe secrets, Vault tokens, PEM private keys,
 * Slack/GitLab tokens, JWT-shaped strings) and fails the publish
 * if any match.
 *
 * Complements `audit-npm-pack.cjs` which audits the *file list*
 * (whitelist of bin/, lib/, scripts/, README.md, LICENSE). This
 * script audits the *content* of those files. A sensitive value
 * accidentally inlined into bin/gordon.cjs or a JS bundle in lib/
 * would pass the file-list audit but fail this one.
 *
 * Usage:
 *   node scripts/npm/audit-npm-pack-content.cjs
 *   node scripts/npm/audit-npm-pack-content.cjs --self-test
 *
 * Exit codes:
 *   0  no findings
 *   1  one or more credential patterns matched
 *   2  unexpected error (missing wrapper, npm pack failed, etc.)
 */

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// ============================================================================
// Patterns
// ============================================================================

/**
 * Credential patterns to scan for. Each entry has a regex and a short
 * name. Regexes use the global flag so we count all occurrences.
 * Conservative: every pattern is tight enough that random text won't
 * match (e.g., AKIA needs 16 trailing uppercase-alphanumerics, not
 * just any "AKIA").
 */
const CREDENTIAL_PATTERNS = [
  { name: "npm token", regex: /npm_[A-Za-z0-9]{36,}/g },
  { name: "GitHub PAT/token", regex: /gh[opusr]_[A-Za-z0-9]{36,}/g },
  { name: "AWS access key", regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "HashiCorp Vault token", regex: /\bhvs\.[A-Za-z0-9_-]{24,}\b/g },
  { name: "Stripe live secret", regex: /\bsk_live_[a-zA-Z0-9]{20,}\b/g },
  { name: "Stripe restricted live", regex: /\brk_live_[a-zA-Z0-9]{20,}\b/g },
  // Order matters: OpenSSH pattern is more specific than the general
  // PEM pattern, so we check it first. Otherwise OpenSSH keys would
  // be reported as the generic "PEM private key" type.
  { name: "OpenSSH private key", regex: /-----BEGIN OPENSSH PRIVATE KEY-----/g },
  { name: "PEM private key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "Slack token", regex: /\bxox[bpoars]-[A-Za-z0-9-]{10,}\b/g },
  { name: "GitLab PAT", regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Anthropic API key", regex: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{20,}\b/g },
  { name: "OpenAI API key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/g },
];

const SKIP_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".gz",
  ".tgz",
  ".zip",
  ".tar",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".pdf",
  ".mp4",
  ".mp3",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB hard cap

// ============================================================================
// Self-test
// ============================================================================

function selfTest() {
  const cases = [
    { input: "AKIAIOSFODNN7EXAMPLE", expected: "AWS access key" },
    { input: "npm_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF", expected: "npm token" },
    { input: "ghp_abcdefghijklmnopqrstuvwxyz0123456789ABC", expected: "GitHub PAT/token" },
    { input: "ghs_abcdefghijklmnopqrstuvwxyz0123456789ABC", expected: "GitHub PAT/token" },
    { input: "hvs.AAABBBCCCDDDEEEFFFGGG12345", expected: "HashiCorp Vault token" },
    { input: "sk_live_abcdefghijklmnopqrstuvwxyz0123456789", expected: "Stripe live secret" },
    { input: "-----BEGIN PRIVATE KEY-----", expected: "PEM private key" },
    { input: "-----BEGIN OPENSSH PRIVATE KEY-----", expected: "OpenSSH private key" },
    { input: "xoxb-1234567890-abcdefghij1234567890", expected: "Slack token" },
    { input: "glpat-abcdefghij12345678901234", expected: "GitLab PAT" },
    { input: "AIzaSyA12345678901234567890123456789012", expected: "Google API key" },
    { input: "sk-ant-api03-abcdefghij1234567890ABCDEF", expected: "Anthropic API key" },
    // Negative cases — should NOT match
    { input: "the word AKIA is common but no key here", expected: null },
    { input: "just some normal source code", expected: null },
    { input: "sk-shorttext", expected: null },
  ];

  let failed = 0;
  for (const c of cases) {
    let hit = null;
    for (const p of CREDENTIAL_PATTERNS) {
      // Reset regex lastIndex since they're stateful with /g
      p.regex.lastIndex = 0;
      if (p.regex.test(c.input)) {
        hit = p.name;
        break;
      }
    }
    const ok = hit === c.expected;
    console.log(
      `${ok ? "PASS" : "FAIL"} | input=${JSON.stringify(c.input).slice(0, 60)} | expected=${c.expected} | got=${hit}`,
    );
    if (!ok) failed++;
  }
  if (failed > 0) {
    console.error(`\nSelf-test FAILED: ${failed} cases failed.`);
    process.exit(1);
  }
  console.log(`\nSelf-test PASSED: all ${cases.length} cases.`);
}

// ============================================================================
// Main scan
// ============================================================================

function getWouldBePublishedFiles(wrapperDir) {
  // `npm pack --dry-run --json` returns an array of pack manifests with
  // a `files` array of { path, size, mode }. We use that as the
  // authoritative list of what would ship.
  let stdout;
  try {
    // execSync (shell-based) so Windows .cmd shims for npm resolve
    // correctly. The wrapperDir input is trusted (resolved from
    // __dirname) and the args are static — no injection surface.
    // --ignore-scripts skips the prepack hook (which writes to stdout
    // and pollutes the JSON output). The wrapper is expected to have
    // been prepared via `npm run prepare:npm-wrapper` already.
    stdout = execSync("npm pack --dry-run --json --ignore-scripts", {
      cwd: wrapperDir,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    if (err.code === "ENOENT" || /not found|not recognized/i.test(err.message)) {
      console.error(
        "audit-npm-pack-content: npm CLI not found in PATH. This audit requires Node + npm; CI has both. Skipping locally.",
      );
      process.exit(0);
    }
    console.error(`audit-npm-pack-content: npm pack --dry-run failed: ${err.message}`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    console.error(`audit-npm-pack-content: npm pack output was not JSON: ${err.message}`);
    process.exit(2);
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !Array.isArray(parsed[0].files)) {
    console.error("audit-npm-pack-content: npm pack output had unexpected shape.");
    process.exit(2);
  }
  return parsed[0].files;
}

function scanFile(absPath, relPath) {
  const findings = [];
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return findings;
  }
  if (stat.size > MAX_FILE_SIZE) {
    return findings; // skip very large files (binaries)
  }
  const ext = path.extname(relPath).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) {
    return findings;
  }
  let content;
  try {
    content = fs.readFileSync(absPath, "utf8");
  } catch {
    return findings; // unreadable / non-text
  }
  for (const pattern of CREDENTIAL_PATTERNS) {
    pattern.regex.lastIndex = 0;
    const matches = content.match(pattern.regex);
    if (matches && matches.length > 0) {
      findings.push({
        file: relPath,
        type: pattern.name,
        count: matches.length,
        // Show only first 12 chars of the match to avoid leaking the
        // (alleged) secret into the audit log itself.
        sample: `${matches[0].slice(0, 12)}…`,
      });
    }
  }
  return findings;
}

function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const wrapperDir = path.resolve(__dirname, "..", "..", "npm");
  if (!fs.existsSync(path.join(wrapperDir, "package.json"))) {
    console.error(
      `audit-npm-pack-content: ${wrapperDir}/package.json not found. Run prepare-npm-wrapper.cjs first.`,
    );
    process.exit(2);
  }

  const files = getWouldBePublishedFiles(wrapperDir);
  const findings = [];
  let scanned = 0;
  let skipped = 0;

  for (const file of files) {
    const absPath = path.join(wrapperDir, file.path);
    const result = scanFile(absPath, file.path);
    if (result.length === 0) {
      const ext = path.extname(file.path).toLowerCase();
      if (SKIP_EXTENSIONS.has(ext)) skipped++;
      else scanned++;
    } else {
      scanned++;
      findings.push(...result);
    }
  }

  if (findings.length > 0) {
    console.error("audit-npm-pack-content: FAIL — credential patterns detected:\n");
    for (const f of findings) {
      console.error(`  ${f.file}`);
      console.error(
        `    ${f.type}: ${f.count} match${f.count > 1 ? "es" : ""} (sample: ${f.sample})`,
      );
    }
    console.error("\nDo NOT publish. Remove the credentials and re-run the audit.");
    console.error(
      "If a match is a confirmed false positive (e.g. a placeholder), adjust the regex precision in scripts/npm/audit-npm-pack-content.cjs.",
    );
    process.exit(1);
  }

  console.log(
    `audit-npm-pack-content: PASS — ${scanned} text files scanned, ${skipped} binary/asset files skipped, ${files.length} total entries in the pack.`,
  );
}

main();
