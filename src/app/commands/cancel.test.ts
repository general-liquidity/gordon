import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONSENT_PATH_ENV } from "../../infra/safety/consent.ts";
import { handleCancelCommand } from "./cancel.ts";

const consentPath = join(
  tmpdir(),
  `gordon-command-cancel-consent-${process.pid}-${Date.now()}.json`,
);
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

function runtime(isSandbox: boolean) {
  const calls: string[] = [];
  return {
    calls,
    runtime: {
      getState: () => ({
        session: {
          exchange: {
            exchangeId: "binance",
            isSandbox,
            getOpenOrders: async () => [{ orderId: "open-1", symbol: "BTCUSDT" }],
            cancelOrder: async () => {
              calls.push("cancel");
            },
          },
        },
      }),
    },
  };
}

describe("/cancel live-consent policy", () => {
  it("refuses generic live cancellation without consent", async () => {
    const fixture = runtime(false);
    const result = await handleCancelCommand("all", fixture.runtime);

    expect(result.cancelled).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.details[0]?.error).toMatch(/live.*ARM|ARM.*live/i);
    expect(fixture.calls).toEqual([]);
  });

  it("allows the same cancellation on a sandbox venue", async () => {
    const fixture = runtime(true);
    const result = await handleCancelCommand("all", fixture.runtime);

    expect(result.cancelled).toBe(1);
    expect(result.failed).toBe(0);
    expect(fixture.calls).toEqual(["cancel"]);
  });
});
