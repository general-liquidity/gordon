import { getDatabase } from "./database.ts";
import type { Trade, TradeStatus } from "../../types/index.ts";

/**
 * Generates a unique trade ID
 */
function generateTradeId(): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `trd_${random}`;
}

/**
 * Converts a database row to a Trade object
 */
function rowToTrade(row: Record<string, unknown>): Trade {
  return {
    id: row.id as string,
    planId: row.planId as string,
    openedAt: row.openedAt as string,
    closedAt: row.closedAt as string | null,
    symbol: row.symbol as string,
    entries: JSON.parse(row.entries as string),
    exits: JSON.parse(row.exits as string),
    averageEntry: row.averageEntry as number,
    realizedPnl: row.realizedPnl as number,
    realizedPnlPercent: row.realizedPnlPercent as number,
    status: row.status as TradeStatus,
  };
}

/**
 * Creates a new trade in the database
 */
export function createTrade(trade: Omit<Trade, "id">): Trade {
  const db = getDatabase();

  const id = generateTradeId();

  const stmt = db.prepare(`
    INSERT INTO trades (id, planId, openedAt, closedAt, symbol, entries, exits, averageEntry, realizedPnl, realizedPnlPercent, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    trade.planId,
    trade.openedAt,
    trade.closedAt,
    trade.symbol,
    JSON.stringify(trade.entries),
    JSON.stringify(trade.exits),
    trade.averageEntry,
    trade.realizedPnl,
    trade.realizedPnlPercent,
    trade.status
  );

  return {
    ...trade,
    id,
  };
}

/**
 * Gets a trade by ID
 */
export function getTrade(id: string): Trade | null {
  const db = getDatabase();

  const stmt = db.prepare("SELECT * FROM trades WHERE id = ?");
  const row = stmt.get(id) as Record<string, unknown> | null;

  if (!row) {
    return null;
  }

  return rowToTrade(row);
}

/**
 * Updates a trade with partial data
 */
export function updateTrade(id: string, updates: Partial<Trade>): Trade {
  const db = getDatabase();

  const existing = getTrade(id);
  if (!existing) {
    throw new Error(`Trade not found: ${id}`);
  }

  const updated: Trade = { ...existing, ...updates };

  const stmt = db.prepare(`
    UPDATE trades
    SET planId = ?, openedAt = ?, closedAt = ?, symbol = ?, entries = ?, exits = ?, averageEntry = ?, realizedPnl = ?, realizedPnlPercent = ?, status = ?
    WHERE id = ?
  `);

  stmt.run(
    updated.planId,
    updated.openedAt,
    updated.closedAt,
    updated.symbol,
    JSON.stringify(updated.entries),
    JSON.stringify(updated.exits),
    updated.averageEntry,
    updated.realizedPnl,
    updated.realizedPnlPercent,
    updated.status,
    id
  );

  return updated;
}

/**
 * Lists trades with optional status filter
 */
export function listTrades(filter?: { status?: TradeStatus }): Trade[] {
  const db = getDatabase();

  let query = "SELECT * FROM trades";
  const params: string[] = [];

  if (filter?.status) {
    query += " WHERE status = ?";
    params.push(filter.status);
  }

  query += " ORDER BY openedAt DESC";

  const stmt = db.prepare(query);
  const rows = (params.length > 0 ? stmt.all(...params) : stmt.all()) as Record<string, unknown>[];

  return rows.map(rowToTrade);
}
