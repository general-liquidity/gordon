#!/usr/bin/env node
/**
 * Generate a CycloneDX Software Bill of Materials for the Gordon
 * source tree using `npm sbom`. CI runs this during release and
 * attaches the output to the GitHub release as `gordon-sbom.json`.
 *
 * Bun does not have an SBOM command (`bun pm sbom` does not exist;
 * `bun pm scan` requires a separately-configured third-party scanner).
 * We rely on the npm CLI already present in CI for the wrapper publish
 * flow. The SBOM is generated against package-lock-only mode so it
 * doesn't require a full `npm install` — it reads our existing
 * `bun.lock` indirectly through a temporary `package-lock.json` shim
 * if one needs to be synthesized, or runs cleanly when invoked after
 * a build step that produced one.
 *
 * Run: `node scripts/dev/codegen/generate-sbom.cjs [--output <path>]`
 *
 * Output: CycloneDX 1.5 JSON. Downstream consumers can verify package
 * integrity hashes and trace the supply chain via the cdx:npm:package
 * fields.
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const outputIdx = args.indexOf("--output");
const outputPath =
  outputIdx >= 0 && args[outputIdx + 1]
    ? path.resolve(args[outputIdx + 1])
    : path.join(rootDir, "gordon-sbom.json");

function fail(message, err) {
  console.error(`[generate-sbom] ${message}`);
  if (err) {
    console.error(err.stderr ? err.stderr.toString() : err.message);
  }
  process.exit(1);
}

let sbomJson;
try {
  // --package-lock-only avoids a full install; --sbom-format=cyclonedx
  // matches what `viewing-package-provenance` documents downstream
  // consumers verifying. --sbom-type=application because Gordon ships
  // as an end-user CLI, not a library.
  const stdout = execFileSync(
    "npm",
    ["sbom", "--sbom-format=cyclonedx", "--sbom-type=application", "--package-lock-only"],
    { cwd: rootDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  sbomJson = stdout;
} catch (err) {
  fail(
    "npm sbom failed (is package-lock.json present? Run `npm install --package-lock-only` first)",
    err,
  );
}

try {
  // Validate it's JSON before writing — npm sbom errors sometimes
  // produce non-JSON output we don't want to ship as an artifact.
  JSON.parse(sbomJson);
} catch (err) {
  fail("npm sbom output was not valid JSON", err);
}

fs.writeFileSync(outputPath, sbomJson, "utf8");
const sizeKb = Math.round(fs.statSync(outputPath).size / 1024);
console.log(`[generate-sbom] Wrote ${outputPath} (${sizeKb} KB).`);
