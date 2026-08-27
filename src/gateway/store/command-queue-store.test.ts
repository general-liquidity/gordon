import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getDatabase, setDatabasePathForTesting } from "../../infra/storage/database.ts";
import { createEnvelopeMeta } from "../protocol/envelope.ts";
import type { GatewayCommandEnvelope, GatewayCommandType } from "../protocol/commands.ts";
import {
  dequeueNextCommand,
  enqueueCommand,
  resetOrphanedRunningCommands,
} from "./command-queue-store.ts";

function makeEnvelope(
  sessionId: string,
  type: GatewayCommandType,
  payload: Record<string, unknown> = {},
): GatewayCommandEnvelope {
  return {
    meta: createEnvelopeMeta({ sessionId, source: "daemon" }),
    command: { type, payload },
  } as GatewayCommandEnvelope;
}

function getRow(id: number): {
  status: string;
  lastError: string | null;
  availableAt: string;
  startedAt: string | null;
  finishedAt: string | null;
} {
  const db = getDatabase();
  return db
    .query(
      "SELECT status, lastError, availableAt, startedAt, finishedAt FROM gateway_command_queue WHERE id = ?",
    )
    .get(id) as ReturnType<typeof getRow>;
}

describe("resetOrphanedRunningCommands", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gordon-queue-store-"));
    setDatabasePathForTesting(join(dir, "gordon.db"));
  });

  afterAll(() => {
    setDatabasePathForTesting(null);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can keep SQLite WAL handles open briefly after close;
      // leftover temp dirs are harmless.
    }
  });

  it("requeues crash-retry-safe running entries as pending", () => {
    const id = enqueueCommand({
      envelope: makeEnvelope("sess-retry-safe", "reconcile.run", { force: false }),
    });
    const dequeued = dequeueNextCommand("sess-retry-safe");
    expect(dequeued?.id).toBe(id);
    expect(getRow(id).status).toBe("running");

    const result = resetOrphanedRunningCommands();

    const row = getRow(id);
    expect(row.status).toBe("pending");
    expect(row.startedAt).toBeNull();
    expect(row.lastError).toContain("orphaned");
    expect(new Date(row.availableAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(result.requeued).toBeGreaterThanOrEqual(1);
    expect(result.entries.find((e) => e.id === id)?.outcome).toBe("pending");

    // Requeued entry must be dequeuable again — the session is unblocked.
    const redequeued = dequeueNextCommand("sess-retry-safe");
    expect(redequeued?.id).toBe(id);

    // Settle the row so later tests see no leftover running entries.
    getDatabase()
      .query("UPDATE gateway_command_queue SET status = 'completed' WHERE id = ?")
      .run(id);
  });

  it("fails non-retry-safe running entries with an explanatory reason", () => {
    const id = enqueueCommand({
      envelope: makeEnvelope("sess-unsafe", "execution.start_intent", {
        symbol: "BTCUSDT",
        side: "BUY",
        totalQuantity: 1,
        algorithm: "TWAP",
        rationale: "Test unsafe algorithmic execution command.",
        config: {},
      }),
    });
    dequeueNextCommand("sess-unsafe");

    const result = resetOrphanedRunningCommands();

    const row = getRow(id);
    expect(row.status).toBe("failed");
    expect(row.finishedAt).not.toBeNull();
    expect(row.lastError).toContain("not crash-retry-safe");
    expect(result.entries.find((e) => e.id === id)?.outcome).toBe("failed");
  });

  it("fails commands not on the allow-list even if unknown (fail closed)", () => {
    const id = enqueueCommand({
      envelope: makeEnvelope("sess-unknown", "chat.send_message", { text: "buy everything" }),
    });
    dequeueNextCommand("sess-unknown");

    resetOrphanedRunningCommands();

    expect(getRow(id).status).toBe("failed");
  });

  it("fails retry-safe entries whose attempts are exhausted", () => {
    const id = enqueueCommand({
      envelope: makeEnvelope("sess-exhausted", "capital.refresh"),
      maxAttempts: 1,
    });
    dequeueNextCommand("sess-exhausted"); // attempts -> 1 == maxAttempts

    resetOrphanedRunningCommands();

    const row = getRow(id);
    expect(row.status).toBe("failed");
    expect(row.lastError).toContain("attempts exhausted");
  });

  it("leaves pending and completed entries untouched", () => {
    const pendingId = enqueueCommand({
      envelope: makeEnvelope("sess-untouched", "runtime.health_check", { aggressive: false }),
    });
    const completedId = enqueueCommand({
      envelope: makeEnvelope("sess-untouched-2", "runtime.health_check", { aggressive: false }),
    });
    dequeueNextCommand("sess-untouched-2");
    getDatabase()
      .query("UPDATE gateway_command_queue SET status = 'completed' WHERE id = ?")
      .run(completedId);

    resetOrphanedRunningCommands();

    expect(getRow(pendingId).status).toBe("pending");
    expect(getRow(completedId).status).toBe("completed");
  });

  it("returns zero counts when nothing is orphaned", () => {
    // Previous tests left no running rows behind.
    const result = resetOrphanedRunningCommands();
    expect(result.requeued).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.entries).toEqual([]);
  });
});
