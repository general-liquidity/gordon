import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RequestContext } from "@mastra/core/request-context";
import { withdrawToExternalTool } from "./wallet.ts";
import { CONSENT_PATH_ENV, recordLiveConsent } from "../../../safety/consent.ts";

let dir: string;
const prevConsentPath = process.env[CONSENT_PATH_ENV];
let withdrawCalls = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gordon-withdraw-consent-"));
  process.env[CONSENT_PATH_ENV] = join(dir, "consent.json");
  withdrawCalls = 0;
});

afterEach(() => {
  if (prevConsentPath === undefined) delete process.env[CONSENT_PATH_ENV];
  else process.env[CONSENT_PATH_ENV] = prevConsentPath;
  rmSync(dir, { recursive: true, force: true });
});

function makeContext(isSandbox: boolean): { requestContext: RequestContext } {
  const requestContext = new RequestContext();
  requestContext.set("exchange", {
    exchangeId: "binance",
    displayName: "Binance",
    isSandbox,
    getBalance: async () => 10,
    getWithdrawalInfo: async () => ({
      coin: "BTC",
      networks: [
        {
          network: "BTC",
          withdrawEnabled: true,
          withdrawFee: 0.0001,
          withdrawMin: 0.001,
          withdrawMax: 0,
          estimatedArrivalMins: 30,
        },
      ],
    }),
    withdraw: async () => {
      withdrawCalls += 1;
      return { id: "wd_1" };
    },
  });
  requestContext.set("config", { permissionMode: "auto" });
  return { requestContext };
}

function withdraw(ctx: { requestContext: RequestContext }) {
  return (
    withdrawToExternalTool as unknown as {
      execute: (
        input: {
          coin: string;
          network: string;
          address: string;
          amount: number;
          tag: string;
          confirm: boolean;
        },
        ctx: { requestContext: RequestContext },
      ) => Promise<{ success?: boolean; error?: string }>;
    }
  ).execute(
    {
      coin: "BTC",
      network: "BTC",
      address: "bc1qexampleaddress",
      amount: 1,
      tag: "",
      confirm: true,
    },
    ctx,
  );
}

describe("withdraw_to_external live-capital consent", () => {
  test("refuses a live withdrawal before consent is acknowledged", async () => {
    const result = await withdraw(makeContext(false));
    expect(result.success).toBeUndefined();
    expect(result.error).toContain("acknowledged live trading");
    expect(withdrawCalls).toBe(0);
  });

  test("proceeds once live consent is on record", async () => {
    recordLiveConsent();
    const result = await withdraw(makeContext(false));
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(withdrawCalls).toBe(1);
  });

  test("sandbox withdrawals do not need consent", async () => {
    const result = await withdraw(makeContext(true));
    expect(result.success).toBe(true);
    expect(withdrawCalls).toBe(1);
  });
});
