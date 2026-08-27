import { beforeEach, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { handleKillSwitchCommand } from "./killswitch.ts";
import { isExecutionAllowed, resetAllKillSwitches } from "../../infra/safety/killSwitches.ts";
import { getSuggestionStore } from "../../infra/proactive/index.ts";
import { installTempGordonHome } from "../../test-utils/tempGordonHome.ts";
import { getAuditHistory } from "../../infra/platform/audit/audit-log.ts";
import { reloadDurableHaltStateForTesting } from "../../infra/safety/durableHaltState.ts";

const tempHome = installTempGordonHome("gordon-killswitch-command-");

beforeEach(() => {
  resetAllKillSwitches("test isolation reset");
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

    const noRationale = await handleKillSwitchCommand("reset firm");
    expect(noRationale.success).toBe(false);
    expect(noRationale.message).toContain("rationale");
    expect(isExecutionAllowed({ venue: "binance" }).allowed).toBe(false);

    const reset = await handleKillSwitchCommand("reset firm drill complete, resuming");
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

  it("archives corrupt durable halt state with a rationale and signed audit record", async () => {
    const path = join(tempHome.current(), "halt-state.json");
    process.env.GORDON_HALT_STATE_PATH = path;
    process.env.GORDON_AUDIT_HMAC_KEY = "killswitch-command-test-key";
    writeFileSync(path, '{"version":1,"portfolios":{},"signature":"tampered"}');
    reloadDurableHaltStateForTesting();

    const refused = await handleKillSwitchCommand("archive-halt-state short");
    const reset = await handleKillSwitchCommand(
      "archive-halt-state operator rotated the halt signing key",
    );

    expect(refused.success).toBe(false);
    expect(reset.success).toBe(true);
    expect(reset.message).toContain("archived");
    expect(getAuditHistory({ action: "HALT_STATE_RESET", result: "SUCCESS" })).toHaveLength(1);
    delete process.env.GORDON_HALT_STATE_PATH;
    delete process.env.GORDON_AUDIT_HMAC_KEY;
    reloadDurableHaltStateForTesting();
  });
});
