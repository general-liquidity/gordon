import { getDatabase } from "./database.ts";
import type { Event, EventType } from "../../types/index.ts";

/**
 * Stored opportunity from a scan
 */
export interface StoredOpportunity {
  id: string;
  timestamp: string;
  symbol: string;
  price: number;
  confidence: number;
  bias: string;
  risk: string;
  change24h: number;
}

/**
 * Generates a unique event ID
 */
function generateEventId(): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `evt_${random}`;
}

/**
 * Converts a database row to an Event object
 */
function rowToEvent(row: Record<string, unknown>): Event {
  const event: Event = {
    id: row.id as string,
    timestamp: row.timestamp as string,
    type: row.type as EventType,
    data: JSON.parse(row.data as string),
  };

  if (row.planId) {
    event.planId = row.planId as string;
  }

  if (row.tradeId) {
    event.tradeId = row.tradeId as string;
  }

  return event;
}

/**
 * Logs a new event to the database
 */
export function logEvent(
  event: Omit<Event, "id" | "timestamp">
): Event {
  const db = getDatabase();

  const id = generateEventId();
  const timestamp = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO events (id, timestamp, type, data, planId, tradeId)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    timestamp,
    event.type,
    JSON.stringify(event.data),
    event.planId ?? null,
    event.tradeId ?? null
  );

  return {
    ...event,
    id,
    timestamp,
  };
}

/**
 * Gets events with optional filters
 */
export function getEvents(filter?: {
  type?: EventType;
  planId?: string;
  tradeId?: string;
}): Event[] {
  const db = getDatabase();

  let query = "SELECT * FROM events";
  const conditions: string[] = [];
  const params: string[] = [];

  if (filter?.type) {
    conditions.push("type = ?");
    params.push(filter.type);
  }

  if (filter?.planId) {
    conditions.push("planId = ?");
    params.push(filter.planId);
  }

  if (filter?.tradeId) {
    conditions.push("tradeId = ?");
    params.push(filter.tradeId);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY timestamp DESC";

  const stmt = db.prepare(query);
  const rows = (params.length > 0 ? stmt.all(...params) : stmt.all()) as Record<string, unknown>[];

  return rows.map(rowToEvent);
}

/**
 * Log a scan opportunity to the database
 */
export function logScanOpportunity(opportunity: {
  symbol: string;
  price: number;
  confidence: number;
  bias: string;
  risk: string;
  change24h: number;
}): void {
  logEvent({
    type: "scan:opportunity" as EventType,
    data: opportunity,
  });
}

/**
 * Get historical scan opportunities with optional filters
 */
export function getHistoricalOpportunities(options?: {
  daysBack?: number;
  symbol?: string;
  minConfidence?: number;
  limit?: number;
}): StoredOpportunity[] {
  const db = getDatabase();
  const daysBack = options?.daysBack ?? 7;
  const limit = options?.limit ?? 100;

  let query = `
    SELECT id, timestamp, data
    FROM events
    WHERE type = 'scan:opportunity'
    AND timestamp > datetime('now', '-${daysBack} days')
  `;

  if (options?.symbol) {
    query += ` AND json_extract(data, '$.symbol') = '${options.symbol}'`;
  }

  if (options?.minConfidence) {
    query += ` AND CAST(json_extract(data, '$.confidence') AS REAL) >= ${options.minConfidence}`;
  }

  query += ` ORDER BY timestamp DESC LIMIT ${limit}`;

  const stmt = db.prepare(query);
  const rows = stmt.all() as Array<{ id: string; timestamp: string; data: string }>;

  return rows.map((row) => {
    const data = JSON.parse(row.data);
    return {
      id: row.id,
      timestamp: row.timestamp,
      symbol: data.symbol,
      price: data.price,
      confidence: data.confidence,
      bias: data.bias,
      risk: data.risk,
      change24h: data.change24h,
    };
  });
}

/**
 * Get count of opportunities by day for the last N days
 */
export function getOpportunitySummary(daysBack: number = 7): Array<{
  date: string;
  count: number;
  symbols: string[];
}> {
  const db = getDatabase();

  const query = `
    SELECT
      date(timestamp) as date,
      COUNT(*) as count,
      GROUP_CONCAT(DISTINCT json_extract(data, '$.symbol')) as symbols
    FROM events
    WHERE type = 'scan:opportunity'
    AND timestamp > datetime('now', '-${daysBack} days')
    GROUP BY date(timestamp)
    ORDER BY date DESC
  `;

  const stmt = db.prepare(query);
  const rows = stmt.all() as Array<{ date: string; count: number; symbols: string }>;

  return rows.map((row) => ({
    date: row.date,
    count: row.count,
    symbols: row.symbols ? row.symbols.split(",") : [],
  }));
}
