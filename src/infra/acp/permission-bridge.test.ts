import { describe, it, expect } from "bun:test";
import { requestAcpPermission } from "./permission-bridge.ts";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";

interface FakeRequestCapture {
  sessionId: string;
  toolCall: { toolCallId: string; title: string; kind: string };
  options: Array<{ optionId: string; kind: string }>;
}

function makeFakeConnection(
  responder: () => Promise<unknown> | unknown,
): { connection: AgentSideConnection; calls: FakeRequestCapture[] } {
  const calls: FakeRequestCapture[] = [];
  const fake = {
    requestPermission: async (req: unknown) => {
      const r = req as FakeRequestCapture;
      calls.push(r);
      return responder();
    },
  } as unknown as AgentSideConnection;
  return { connection: fake, calls };
}

describe("requestAcpPermission", () => {
  it("issues a request with 4 standard options + matching kinds", async () => {
    const { connection, calls } = makeFakeConnection(() => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
    }));
    await requestAcpPermission(connection, {
      sessionId: "abc",
      toolName: "place_market_order",
      toolCallId: "tc_1",
      reason: "Approve market order on BTCUSDT?",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sessionId).toBe("abc");
    expect(calls[0]!.options.length).toBe(4);
    const ids = calls[0]!.options.map((o) => o.optionId).sort();
    expect(ids).toEqual(["allow_always", "allow_once", "reject_always", "reject_once"]);
  });

  it("maps allow_once → approve with persist=false", async () => {
    const { connection } = makeFakeConnection(() => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
    }));
    const verdict = await requestAcpPermission(connection, {
      sessionId: "s",
      toolName: "x",
      toolCallId: "tc",
      reason: "y",
    });
    expect(verdict).toEqual({ kind: "approve", persist: false });
  });

  it("maps allow_always → approve with persist=true", async () => {
    const { connection } = makeFakeConnection(() => ({
      outcome: { outcome: "selected", optionId: "allow_always" },
    }));
    const verdict = await requestAcpPermission(connection, {
      sessionId: "s",
      toolName: "x",
      toolCallId: "tc",
      reason: "y",
    });
    expect(verdict).toEqual({ kind: "approve", persist: true });
  });

  it("maps reject_once → reject with persist=false", async () => {
    const { connection } = makeFakeConnection(() => ({
      outcome: { outcome: "selected", optionId: "reject_once" },
    }));
    const verdict = await requestAcpPermission(connection, {
      sessionId: "s",
      toolName: "x",
      toolCallId: "tc",
      reason: "y",
    });
    expect(verdict).toEqual({ kind: "reject", persist: false });
  });

  it("maps reject_always → reject with persist=true", async () => {
    const { connection } = makeFakeConnection(() => ({
      outcome: { outcome: "selected", optionId: "reject_always" },
    }));
    const verdict = await requestAcpPermission(connection, {
      sessionId: "s",
      toolName: "x",
      toolCallId: "tc",
      reason: "y",
    });
    expect(verdict).toEqual({ kind: "reject", persist: true });
  });

  it("maps cancelled outcome → cancelled verdict", async () => {
    const { connection } = makeFakeConnection(() => ({ outcome: { outcome: "cancelled" } }));
    const verdict = await requestAcpPermission(connection, {
      sessionId: "s",
      toolName: "x",
      toolCallId: "tc",
      reason: "y",
    });
    expect(verdict).toEqual({ kind: "cancelled" });
  });

  it("maps unknown optionId → cancelled (defensive)", async () => {
    const { connection } = makeFakeConnection(() => ({
      outcome: { outcome: "selected", optionId: "weird_option" },
    }));
    const verdict = await requestAcpPermission(connection, {
      sessionId: "s",
      toolName: "x",
      toolCallId: "tc",
      reason: "y",
    });
    expect(verdict).toEqual({ kind: "cancelled" });
  });

  it("propagates connection errors to the caller", async () => {
    const { connection } = makeFakeConnection(() => {
      throw new Error("editor disconnected");
    });
    await expect(
      requestAcpPermission(connection, {
        sessionId: "s",
        toolName: "x",
        toolCallId: "tc",
        reason: "y",
      }),
    ).rejects.toThrow(/editor disconnected/);
  });
});
