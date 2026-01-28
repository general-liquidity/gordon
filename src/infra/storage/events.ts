import { getDatabase } from "./database.ts";
import type { Event, EventType } from "../../types/index.ts";

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
