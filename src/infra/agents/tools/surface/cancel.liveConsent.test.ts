import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RequestContext } from "@mastra/core/request-context";

import { CONSENT_PATH_ENV } from "../../../safety/consent.ts";
import { cancelTool } from "./plan.ts";

const consentPath = join(tmpdir(), `gordon-cancel-consent-${process.pid}-${Date.now()}.json`);
let priorConsentPath: string | undefined;

beforeAll(() => {
  priorConsentPath = process.env[CONSENT_PATH_ENV];
  process.env[CONSENT_PATH_ENV] = consentPath;
  if (existsSync(consentPath)) rmSync(consentPath);
});

afterAll(() => {
  if (existsSync(consentPath)) rmSync(consentPath);
  if (priorConsentPath === undefined) delete process.env[CONSENT_PATH_ENV];
  else process.env[CONSENT_PATH_ENV] = priorConsentPath;
});

function executionContext(isSandbox: boolean) {
  const calls: string[] = [];
  const requestContext = new RequestContext();
  requestContext.set("exchange", {
    exchangeId: "binance",
    isSandbox,
    cancelOrder: async () => {
      calls.push("one");
    },
    cancelAllOrders: async () => {
      calls.push("all");
      return [];
    },
  });
  return { calls, context: { requestContext } as never };
}

describe("cancel tool live-consent policy", () => {
  it("refuses a generic live order cancellation without consent", async () => {
    const { calls, context } = executionContext(false);
    const result = await cancelTool.execute!(
      {
        target: "order",
        id: "order-1",
        symbol: "BTCUSDT",
        reason: "operator requested cancellation",
      },
      context,
    );
    if (!result || !("success" in result)) throw new Error("cancel tool returned no result");
    expect(result.success).toBe(false);
    expect(calls).toEqual([]);
  });

  it("refuses cancel-all on a live venue without consent", async () => {
    const { calls, context } = executionContext(false);
    const result = await cancelTool.execute!(
      { target: "all_orders", symbol: "BTCUSDT", reason: "operator requested cancellation" },
      context,
    );
    if (!result || !("success" in result)) throw new Error("cancel tool returned no result");
    expect(result.success).toBe(false);
    expect(calls).toEqual([]);
  });

  it("allows the same cancellation in a sandbox", async () => {
    const { calls, context } = executionContext(true);
    const result = await cancelTool.execute!(
      {
        target: "order",
        id: "order-1",
        symbol: "BTCUSDT",
        reason: "operator requested cancellation",
      },
      context,
    );
    if (!result || !("success" in result)) throw new Error("cancel tool returned no result");
    expect(result.success).toBe(true);
    expect(calls).toEqual(["one"]);
  });
});
