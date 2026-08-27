import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleAlertsCommand } from "./alerts.ts";

describe("handleAlertsCommand persistence", () => {
  let dir = "";
  const priorHome = process.env.GORDON_HOME;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gordon-alerts-"));
    process.env.GORDON_HOME = dir;
  });

  afterEach(() => {
    if (priorHome === undefined) delete process.env.GORDON_HOME;
    else process.env.GORDON_HOME = priorHome;
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists an alert before reporting success", () => {
    const response = handleAlertsCommand("set BTCUSDT 50000 below");
    const stored = JSON.parse(readFileSync(join(dir, "alerts.json"), "utf8"));

    expect(response).toContain("Alert set");
    expect(stored).toMatchObject([{ symbol: "BTCUSDT", targetPrice: 50_000, direction: "below" }]);
  });

  it("does not replace a corrupt alert file with an empty list", () => {
    const path = join(dir, "alerts.json");
    writeFileSync(path, "not-json");

    expect(handleAlertsCommand("set ETHUSDT 3000 above")).toContain("Alerts unavailable");
    expect(readFileSync(path, "utf8")).toBe("not-json");
  });
});
