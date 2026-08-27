import { resolve } from "node:path";
import { deriveReleaseTestShards } from "./release-matrix.ts";

const repoRoot = resolve(import.meta.dir, "..", "..", "..");
const shards = deriveReleaseTestShards(resolve(repoRoot, ".github/workflows/release.yml"));

if (shards.length === 0 || shards.some((paths) => paths.length === 0)) {
  throw new Error("Could not derive release test shards from .github/workflows/release.yml");
}

if (process.argv.includes("--list")) {
  for (const [index, paths] of shards.entries()) {
    console.log(`${index + 1}: ${paths.join(" ")}`);
  }
  process.exit(0);
}

for (const [index, paths] of shards.entries()) {
  console.log(`\n[release rehearsal] shard ${index + 1}/${shards.length}`);
  const child = Bun.spawn([process.execPath, "test", ...paths], {
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exit(exitCode);
}
