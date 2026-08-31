import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  assertGordonVersionOutput,
  deriveJobBunVersion,
  deriveJobBunVersionFromSource,
  deriveReleaseBinaryTargets,
  deriveReleaseTestShards,
} from "../../../scripts/dev/release/release-matrix.ts";

const root = resolve(import.meta.dir, "..", "..", "..");

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("pre-tag release rehearsal", () => {
  test("reuses the tag workflow's shard and binary matrices", () => {
    const shardRunner = source("scripts/dev/release/rehearse-test-shards.ts");
    const binaryRunner = source("scripts/dev/release/rehearse-binaries.ts");

    expect(shardRunner).toContain(".github/workflows/release.yml");
    expect(binaryRunner).toContain(".github/workflows/release.yml");

    const workflowPath = resolve(root, ".github/workflows/release.yml");
    const binaries = deriveReleaseBinaryTargets(workflowPath);
    const shards = deriveReleaseTestShards(workflowPath);
    expect(binaries).toHaveLength(8);
    expect(shards).toHaveLength(8);
    expect(binaries.map((target) => target.binaryName).sort()).toEqual([
      "gordon-darwin-arm64",
      "gordon-darwin-x64",
      "gordon-linux-arm64",
      "gordon-linux-arm64-musl",
      "gordon-linux-x64",
      "gordon-linux-x64-musl",
      "gordon-windows-arm64.exe",
      "gordon-windows-x64.exe",
    ]);
  });

  test("stages and hashes all eight derived binaries without touching production manifests", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "gordon-release-rehearsal-"));
    const binariesDir = resolve(dir, "binaries");
    const outputDir = resolve(dir, "output");
    const productionFormula = source("Formula/gordon.rb");
    const productionScoop = source("scripts/scoop/gordon.json");
    const targets = deriveReleaseBinaryTargets(resolve(root, ".github/workflows/release.yml"));
    try {
      mkdirSync(binariesDir, { recursive: true });
      for (const target of targets) {
        writeFileSync(resolve(binariesDir, target.binaryName), `binary:${target.name}`, "utf8");
      }
      const result = Bun.spawnSync(
        [
          process.execPath,
          "scripts/dev/release/rehearse-package-staging.ts",
          "--binaries",
          binariesDir,
          "--output",
          outputDir,
          "--skip-host-smoke",
        ],
        { cwd: root, env: process.env },
      );
      expect(result.exitCode).toBe(0);
      const manifest = JSON.parse(
        readFileSync(resolve(outputDir, "staging/manifest.json"), "utf8"),
      );
      expect(manifest.staged).toHaveLength(8);
      expect(manifest.skipped).toEqual([]);
      expect(
        readFileSync(resolve(outputDir, "scripts/SHA256SUMS"), "utf8").match(/^[0-9a-f]{64} {2}/gm),
      ).toHaveLength(8);
      expect(source("Formula/gordon.rb")).toBe(productionFormula);
      expect(source("scripts/scoop/gordon.json")).toBe(productionScoop);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("requires the executable host artifact to report the exact package version", () => {
    const version = JSON.parse(source("package.json")).version;
    expect(() => assertGordonVersionOutput(`gordon v${version}\n`, version)).not.toThrow();
    expect(() => assertGordonVersionOutput("gordon v0.8.8\n", version)).toThrow(
      `expected gordon v${version}`,
    );
    expect(source("scripts/dev/release/rehearse-package-staging.ts")).toContain('"--version"');
    expect(source(".github/workflows/release-rehearsal.yml")).not.toContain("--skip-host-smoke");
  });

  test("runs every release-only failure point without publishing", () => {
    const workflow = source(".github/workflows/release-rehearsal.yml");

    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("npm ci --ignore-scripts");
    expect(workflow).toContain("generate-sbom.cjs");
    expect(workflow).toContain("check:npm-wrapper");
    expect(workflow).toContain("rehearse-test-shards.ts");
    expect(workflow).toContain("rehearse-binaries.ts");
    expect(workflow).toContain("rehearse-package-staging.ts");
    expect(workflow).toContain("test:broker-conformance");
    expect(workflow).toContain("quality:brokers");
    expect(workflow).toContain("audit-npm-pack.cjs");
    expect(workflow).toContain("rehearse-source-package.ts");
    expect(workflow).toContain("audit-npm-pack-content.cjs");
    expect(workflow).toContain("check-no-sourcemaps.cjs");
    expect(workflow).toContain("prepare-public-dist.cjs");
    expect(workflow).toContain("matrix.os");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("pull_request:");
    expect(workflow).not.toContain("paths:");
    expect(workflow).not.toMatch(/npm publish|gh release|action-gh-release/);
  });

  test("the release guide requires a green rehearsal before tagging", () => {
    const guide = source("RELEASE.md");
    expect(guide).toContain("gh workflow run release-rehearsal.yml");
    expect(guide).toMatch(/before creating a tag/i);
  });

  test("the authoritative release matrix still contains windows-arm64", () => {
    expect(source(".github/workflows/release.yml")).toContain("bun_target: bun-windows-arm64");
  });
});

// The rehearsal is a copy of the release path, so every pin it duplicates can
// drift out of step with the real one. The bun version is the pin that matters
// most: v0.5.4 shipped without gordon-windows-arm64.exe because the build job
// was on 1.3.7, which does not publish that cross-compile target. A rehearsal
// green on a different bun than the release proves nothing about the release.
describe("the rehearsal and the release agree on their toolchain", () => {
  function bunVersions(path: string): string[] {
    return [...source(path).matchAll(/bun-version:\s*(\S+)/g)].map((m) => m[1] as string);
  }

  test("the binary-building bun version is the same in both", () => {
    const release = deriveJobBunVersion(resolve(root, ".github/workflows/release.yml"), "build");
    const rehearsal = deriveJobBunVersion(
      resolve(root, ".github/workflows/release-rehearsal.yml"),
      "binary-targets",
    );

    expect(rehearsal).toBe(release);
  });

  test("an unrelated newer pin cannot hide a binary-job regression", () => {
    const workflow = `jobs:
  test:
    steps:
      - with:
          bun-version: 1.4.0
  build:
    steps:
      - with:
          bun-version: 1.3.7
  publish:
    steps: []
`;

    expect(deriveJobBunVersionFromSource(workflow, "build")).toBe("1.3.7");
  });

  test("every bun version the rehearsal pins is one the release also pins", () => {
    const release = new Set(bunVersions(".github/workflows/release.yml"));

    for (const version of bunVersions(".github/workflows/release-rehearsal.yml")) {
      expect([...release]).toContain(version);
    }
  });
});
