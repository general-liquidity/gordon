#!/usr/bin/env node
/**
 * Stage per-platform npm sub-packages for @general-liquidity/gordon.
 *
 * Distribution model (codex build_npm_package.py pattern): each compiled
 * binary is published as its own versioned package —
 * @general-liquidity/gordon-<target> — carrying os/cpu/libc metadata so npm
 * installs only the one matching the host. The root wrapper lists them all as
 * optionalDependencies; missing targets degrade gracefully (npm skips an
 * optional dep that fails to resolve).
 *
 * This script reads the built binaries out of --binaries <dir> (asset names as
 * they land on the GitHub Release, e.g. gordon-linux-x64, gordon-windows-x64.exe)
 * and writes one ready-to-publish package dir per available target under
 * --out <dir>. Targets whose binary is absent are skipped (best-effort — lets
 * win32-arm64 be missing without failing the release).
 *
 * Usage:
 *   node scripts/npm/stage-platform-packages.cjs \
 *     --binaries dist-assets --out staging --version 0.9.0 [--manifest staging/manifest.json]
 *
 * Output:
 *   <out>/@general-liquidity/gordon-<target>/package.json
 *   <out>/@general-liquidity/gordon-<target>/vendor/<target>/bin/gordon[.exe]
 *   plus a JSON manifest (stdout, and --manifest file if given) describing the
 *   staged packages + per-asset sha256 (for Formula/Scoop templating + SHA256SUMS).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SCOPE = "@general-liquidity";

// Canonical target table. `target` is the npm sub-package suffix AND the vendor
// subdir the launcher (npm/bin/gordon.cjs) spawns from. `asset` is the binary
// filename as built by the release matrix / attached to the GitHub Release.
// Kept as a flat table (not derived) so a human reading a release failure can
// see exactly which asset maps to which package.
const TARGETS = [
  { target: "linux-x64", asset: "gordon-linux-x64", os: "linux", cpu: "x64", libc: "glibc" },
  { target: "linux-arm64", asset: "gordon-linux-arm64", os: "linux", cpu: "arm64", libc: "glibc" },
  { target: "linux-x64-musl", asset: "gordon-linux-x64-musl", os: "linux", cpu: "x64", libc: "musl" },
  { target: "linux-arm64-musl", asset: "gordon-linux-arm64-musl", os: "linux", cpu: "arm64", libc: "musl" },
  { target: "darwin-x64", asset: "gordon-darwin-x64", os: "darwin", cpu: "x64" },
  { target: "darwin-arm64", asset: "gordon-darwin-arm64", os: "darwin", cpu: "arm64" },
  { target: "win32-x64", asset: "gordon-windows-x64.exe", os: "win32", cpu: "x64" },
  { target: "win32-arm64", asset: "gordon-windows-arm64.exe", os: "win32", cpu: "arm64" }
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--binaries") out.binaries = argv[++i];
    else if (flag === "--out") out.out = argv[++i];
    else if (flag === "--version") out.version = argv[++i];
    else if (flag === "--manifest") out.manifest = argv[++i];
  }
  return out;
}

function sha256OfFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.binaries || !args.out || !args.version) {
    console.error(
      "Usage: node scripts/npm/stage-platform-packages.cjs --binaries <dir> --out <dir> --version <v> [--manifest <file>]"
    );
    process.exit(1);
  }

  const binariesDir = path.resolve(args.binaries);
  const outDir = path.resolve(args.out);
  const version = String(args.version).replace(/^v/, "");

  if (!fs.existsSync(binariesDir) || !fs.statSync(binariesDir).isDirectory()) {
    console.error(`[stage] binaries dir not found: ${binariesDir}`);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const staged = [];
  const skipped = [];

  for (const entry of TARGETS) {
    const assetPath = path.join(binariesDir, entry.asset);
    if (!fs.existsSync(assetPath)) {
      skipped.push(entry.target);
      continue;
    }

    const packageName = `${SCOPE}/gordon-${entry.target}`;
    const packageDir = path.join(outDir, SCOPE, `gordon-${entry.target}`);
    const binaryName = entry.os === "win32" ? "gordon.exe" : "gordon";
    const binDir = path.join(packageDir, "vendor", entry.target, "bin");
    fs.mkdirSync(binDir, { recursive: true });

    const destBinary = path.join(binDir, binaryName);
    fs.copyFileSync(assetPath, destBinary);
    if (entry.os !== "win32") {
      fs.chmodSync(destBinary, 0o755);
    }

    const pkg = {
      name: packageName,
      version,
      description: `Prebuilt gordon binary for ${entry.target}`,
      license: "MIT",
      repository: {
        type: "git",
        url: "https://github.com/general-liquidity/gordon.git"
      },
      os: [entry.os],
      cpu: [entry.cpu],
      files: ["vendor"]
    };
    // libc gates glibc vs musl automatically at install time (npm >= 10 /
    // pnpm / yarn honour it). Only meaningful on linux.
    if (entry.libc) {
      pkg.libc = [entry.libc];
    }

    fs.writeFileSync(
      path.join(packageDir, "package.json"),
      `${JSON.stringify(pkg, null, 2)}\n`,
      "utf8"
    );

    staged.push({
      name: packageName,
      target: entry.target,
      asset: entry.asset,
      dir: packageDir,
      sha256: sha256OfFile(assetPath)
    });
  }

  const manifest = { version, staged, skipped };

  if (args.manifest) {
    fs.mkdirSync(path.dirname(path.resolve(args.manifest)), { recursive: true });
    fs.writeFileSync(path.resolve(args.manifest), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  for (const item of staged) {
    console.error(`[stage] ${item.name}@${version}  <- ${item.asset}`);
  }
  if (skipped.length > 0) {
    console.error(`[stage] skipped (no binary): ${skipped.join(", ")}`);
  }

  // Machine-readable manifest on stdout for the publish loop.
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}

main();
