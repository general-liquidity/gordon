import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { resolveDaemonSpawnCommand } from "./spawnCommand.ts";

const repoRoot = resolve(import.meta.dir, "..", "..", "..");

describe("gateway daemon startup validation", () => {
  it("respawns source launches through the hardened Node launcher", () => {
    expect(
      resolveDaemonSpawnCommand(["bun", resolve(repoRoot, "src", "entry.ts"), "daemon", "start"]),
    ).toEqual({
      command: "node",
      args: [resolve(repoRoot, "bin", "gordon.cjs"), "daemon", "run"],
    });
  });

  it("respawns a compiled launch through the compiled executable", () => {
    const executable = resolve(repoRoot, "gordon-test-binary");
    expect(resolveDaemonSpawnCommand([executable, "daemon", "start"], executable)).toEqual({
      command: executable,
      args: ["daemon", "run"],
    });
  });

  it("boots, serves authenticated health over IPC, and stops without a model or venue", async () => {
    const child = Bun.spawn([process.execPath, "scripts/dev/checks/validate-daemon-startup.ts"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 30_000);
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]).finally(() => clearTimeout(timeout));

    expect(exitCode, stderr).toBe(0);
    const recordLine = stdout.split("\n").find((line) => line.includes('"validationOnly":true'));
    expect(recordLine, `${stdout}\n${stderr}`).toBeDefined();
    const record = JSON.parse(recordLine!) as Record<string, unknown>;
    expect(record).toMatchObject({
      status: "pass",
      validationOnly: true,
      modelInference: false,
      venueResolved: false,
      orderDispatch: false,
      healthOk: true,
      schedulerHealthRan: true,
      persistedTaskSuppressed: true,
      stoppedCleanly: true,
    });
  }, 35_000);
});
