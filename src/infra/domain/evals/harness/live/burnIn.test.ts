import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EvalScenario } from "../types.ts";
import { ADVERSARIAL_SCENARIOS } from "../scenarios/index.ts";
import { runUnattendedBurnIn } from "./burnIn.ts";

const scenario: EvalScenario = {
  id: "burn-in-read-only",
  tags: ["scan"],
  category: "scan",
  systemPrompt: "You are a read-only trading analyst.",
  userInput: "Scan BTC without trading.",
};

let root = "";

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("runUnattendedBurnIn", () => {
  it("writes one no-model/no-order heartbeat per completed cycle", async () => {
    root = mkdtempSync(join(tmpdir(), "gordon-burn-in-test-"));
    const evidencePath = join(root, "evidence", "heartbeats.jsonl");
    const child = Bun.spawn(
      [
        process.execPath,
        "scripts/dev/eval/eval-unattended-burn-in.ts",
        "--scenario",
        ADVERSARIAL_SCENARIOS[0]!.id,
        "--cycles",
        "2",
        "--k",
        "2",
        "--output",
        evidencePath,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

    expect(exitCode, stderr).toBe(0);
    expect(existsSync(evidencePath)).toBe(true);
    const rows = readFileSync(evidencePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.trajectoryCount)).toEqual([2, 2]);
    expect(rows.every((row) => row.dryRun && !row.modelInference && !row.orderDispatch)).toBe(true);
    expect(rows.every((row) => row.allProcessChecksPassed)).toBe(true);
    // This is an end-to-end child-process test. It normally completes in
    // ~1.5s, but a full 900-file Bun run can saturate Windows process startup
    // long enough to cross the default 20s ceiling even though the child is
    // healthy. Keep a bounded margin for that host contention.
  }, 60_000);

  it("rejects invalid cycle counts before creating evidence", async () => {
    root = mkdtempSync(join(tmpdir(), "gordon-burn-in-test-"));
    const evidencePath = join(root, "heartbeats.jsonl");
    await expect(
      runUnattendedBurnIn({ scenarios: [scenario], cycles: 0, evidencePath }),
    ).rejects.toThrow(/cycles/);
    expect(existsSync(evidencePath)).toBe(false);
  });
});
