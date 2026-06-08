import { describe, expect, it } from "bun:test";
import { executeWithFailover } from "./providerFailover.ts";

const chain = [{ id: "anthropic" }, { id: "openai" }, { id: "google" }];
const idOf = (c: { id: string }) => c.id;

describe("executeWithFailover", () => {
  it("uses the primary when it succeeds (not degraded)", async () => {
    const r = await executeWithFailover({
      chain,
      idOf,
      call: async (c) => `ok:${c.id}`,
    });
    expect(r.ok).toBe(true);
    expect(r.result).toBe("ok:anthropic");
    expect(r.usedIndex).toBe(0);
    expect(r.degraded).toBe(false);
    expect(r.attempts).toBe(1);
  });

  it("fails over to the next provider and flags degraded", async () => {
    const r = await executeWithFailover({
      chain,
      idOf,
      call: async (c) => {
        if (c.id === "anthropic") throw new Error("503 down");
        return `ok:${c.id}`;
      },
    });
    expect(r.ok).toBe(true);
    expect(r.result).toBe("ok:openai");
    expect(r.usedIndex).toBe(1);
    expect(r.degraded).toBe(true);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.id).toBe("anthropic");
  });

  it("reports failure when the whole chain is exhausted", async () => {
    const r = await executeWithFailover({
      chain,
      idOf,
      call: async () => {
        throw new Error("down");
      },
    });
    expect(r.ok).toBe(false);
    expect(r.usedIndex).toBe(-1);
    expect(r.degraded).toBe(true);
    expect(r.errors).toHaveLength(3);
  });

  it("does NOT fail over on a fatal error (rethrows)", async () => {
    const attempt = { count: 0 };
    await expect(
      executeWithFailover({
        chain,
        idOf,
        call: async () => {
          attempt.count++;
          throw new Error("content_policy_refusal");
        },
        isFatal: (e) => e instanceof Error && e.message.includes("content_policy"),
      }),
    ).rejects.toThrow("content_policy");
    expect(attempt.count).toBe(1); // stopped at the primary, no failover
  });
});
