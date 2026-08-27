import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDatabase, setDatabasePathForTesting } from "../../infra/storage/database.ts";
import type { PortfolioContext } from "./portfolio-context.ts";
import { RiskAuditLog, type RiskAuditEntry } from "./audit.ts";

const paths = [
  join(tmpdir(), `gordon-risk-audit-a-${process.pid}-${Date.now()}.db`),
  join(tmpdir(), `gordon-risk-audit-b-${process.pid}-${Date.now()}.db`),
];

const portfolio: PortfolioContext = {
  totalEquity: 10_000,
  availableBalance: 10_000,
  openPositions: [],
  todayPnL: 0,
  todayTradeCount: 0,
  currentDrawdown: 0,
  peakEquity: 10_000,
};

function entry(id: string): RiskAuditEntry {
  const order = {
    symbol: "BTCUSDT",
    side: "buy" as const,
    type: "limit" as const,
    quantity: 0.01,
    price: 50_000,
    exchangeId: "sandbox",
    agentId: "test",
  };
  return {
    id,
    timestamp: new Date().toISOString(),
    order,
    decision: {
      approved: true,
      action: "approve",
      originalOrder: order,
      checks: [],
      timestamp: new Date().toISOString(),
    },
    portfolioSnapshot: portfolio,
  };
}

function auditRowCount(): number | undefined {
  const statement = getDatabase().query<{ count: number }, []>(
    "SELECT COUNT(*) AS count FROM risk_audit",
  );
  try {
    return statement.get()?.count;
  } finally {
    statement.finalize();
  }
}

afterAll(() => {
  setDatabasePathForTesting(null);
  for (const path of paths) {
    for (const suffix of ["", "-wal", "-shm"]) {
      const candidate = `${path}${suffix}`;
      if (existsSync(candidate)) rmSync(candidate, { maxRetries: 5, retryDelay: 100 });
    }
  }
});

describe("risk audit schema follows database rotation", () => {
  it("initializes and writes the table in every database instance", async () => {
    const log = new RiskAuditLog();

    setDatabasePathForTesting(paths[0]!);
    await log.log(entry("first-db"));
    expect(auditRowCount()).toBe(1);

    setDatabasePathForTesting(paths[1]!);
    await log.log(entry("second-db"));
    expect(auditRowCount()).toBe(1);
  });
});
