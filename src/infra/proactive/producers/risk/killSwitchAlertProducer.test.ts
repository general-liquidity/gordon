import { describe, expect, test, beforeEach } from "bun:test";
import {
  killSwitchAlertProducer,
  resetKillSwitchAlertProducerState,
} from "./killSwitchAlertProducer.ts";
import type { ProactiveObservation } from "../../engine/proactiveEngine.ts";
import {
  resetAllKillSwitches,
  tripKillSwitch,
} from "../../../safety/killSwitches.ts";

const TICK_OBS: ProactiveObservation = {
  source: "monitor_loop",
  eventType: "tick_kill_switch",
  timestamp: Date.now(),
};

describe("killSwitchAlertProducer", () => {
  beforeEach(() => {
    resetKillSwitchAlertProducerState();
    resetAllKillSwitches();
  });

  test("ignores observations that are not tick_kill_switch", async () => {
    const wrongEvent: ProactiveObservation = {
      source: "monitor_loop",
      eventType: "tick_producer_health",
      timestamp: 0,
    };
    const wrongSource: ProactiveObservation = {
      source: "event_bus",
      eventType: "tick_kill_switch",
      timestamp: 0,
    };
    expect(await killSwitchAlertProducer(wrongEvent)).toEqual([]);
    expect(await killSwitchAlertProducer(wrongSource)).toEqual([]);
  });

  test("returns empty when no switches are tripped", async () => {
    expect(await killSwitchAlertProducer(TICK_OBS)).toEqual([]);
  });

  test("fires a risk_warning card when switches are tripped", async () => {
    tripKillSwitch({ scope: "firm" }, "system-wide halt");
    const cards = await killSwitchAlertProducer(TICK_OBS);
    expect(cards.length).toBe(1);
    expect(cards[0]!.category).toBe("risk_warning");
    expect(cards[0]!.title).toContain("Kill switch tripped");
    expect(cards[0]!.body).toContain("firm");
    expect(cards[0]!.action).toBe("/killswitch list");
  });

  test("respects cooldown for the same trip signature", async () => {
    tripKillSwitch({ scope: "venue", id: "binance" }, "venue degraded");
    const first = await killSwitchAlertProducer(TICK_OBS);
    const second = await killSwitchAlertProducer(TICK_OBS);
    expect(first.length).toBe(1);
    expect(second).toEqual([]);
  });
});