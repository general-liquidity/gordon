import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { deriveReleaseBinaryTargets } from "./release-matrix.ts";

const repoRoot = resolve(import.meta.dir, "..", "..", "..");
const targets = deriveReleaseBinaryTargets(resolve(repoRoot, ".github/workflows/release.yml"));

if (targets.length === 0 || !targets.some((target) => target.bunTarget === "bun-windows-arm64")) {
  throw new Error("Could not derive the complete binary matrix from .github/workflows/release.yml");
}

if (process.argv.includes("--list")) {
  for (const target of targets) console.log(`${target.name}: ${target.bunTarget}`);
  process.exit(0);
}

const outputArg = process.argv.indexOf("--output");
const outputDir =
  outputArg >= 0 && process.argv[outputArg + 1]
    ? resolve(process.argv[outputArg + 1]!)
    : resolve(repoRoot, ".release-rehearsal", "binaries");
mkdirSync(outputDir, { recursive: true });

for (const [index, target] of targets.entries()) {
  console.log(`\n[release rehearsal] binary ${index + 1}/${targets.length}: ${target.name}`);
  let exitCode = 1;
  for (let attempt = 1; attempt <= 3 && exitCode !== 0; attempt++) {
    const child = Bun.spawn(
      [
        process.execPath,
        "scripts/build/build.ts",
        "--binary",
        "--target",
        target.bunTarget,
        "--outfile",
        resolve(outputDir, target.binaryName),
      ],
      { cwd: repoRoot, stdout: "inherit", stderr: "inherit", env: process.env },
    );
    exitCode = await child.exited;
    if (exitCode !== 0 && attempt < 3) console.warn(`Build attempt ${attempt} failed; retrying.`);
  }
  if (exitCode !== 0) process.exit(exitCode);
}
