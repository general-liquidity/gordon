import { beforeEach, describe, expect, it } from "bun:test";
import { handleKillSwitchCommand } from "./killswitch.ts";
import { isExecutionAllowed, resetAllKillSwitches } from "../../infra/safety/killSwitches.ts";
import { getSuggestionStore } from "../../infra/proactive/index.ts";

beforeEach(() => {
  resetAllKillSwitches();
  getSuggestionStore().clear();
});

describe("handleKillSwitchCommand", () => {
  it("trips, lists, and resets a firm kill switch", async () => {
    const trip = await handleKillSwitchCommand("trip firm manual halt");
    expect(trip.success).toBe(true);
    expect(isExecutionAllowed({ venue: "binance" }).allowed).toBe(false);

    const list = await handleKillSwitchCommand("list");
    expect(list.message).toContain("firm");
    expect(list.message).toContain("manual halt");

    const reset = await handleKillSwitchCommand("reset firm");
    expect(reset.success).toBe(true);
    expect(isExecutionAllowed({ venue: "binance" }).allowed).toBe(true);
  });

  it("requires ids for scoped kill switches", async () => {
    const result = await handleKillSwitchCommand("trip venue");
    expect(result.success).toBe(false);
    expect(result.message).toContain("requires an id");
  });

  it("trips only the matching scoped venue", async () => {
    await handleKillSwitchCommand("trip venue binance venue outage");
    expect(isExecutionAllowed({ venue: "binance" }).allowed).toBe(false);
    expect(isExecutionAllowed({ venue: "coinbase" }).allowed).toBe(true);
  });
});

