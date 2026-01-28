import { getDatabase } from "./database.ts";
import type { Plan, PlanStatus } from "../../types/index.ts";

/**
 * Generates a unique plan ID
 */
function generatePlanId(): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `pln_${random}`;
}

/**
 * Converts a database row to a Plan object
 */
function rowToPlan(row: Record<string, unknown>): Plan {
  return {
    id: row.id as string,
    createdAt: row.createdAt as string,
    symbol: row.symbol as string,
    direction: row.direction as "long",
    strategy: row.strategy as "support_bounce",
    allocation: JSON.parse(row.allocation as string),
    entry: JSON.parse(row.entry as string),
    dca: row.dca ? JSON.parse(row.dca as string) : null,
    stopLoss: JSON.parse(row.stopLoss as string),
    takeProfit: JSON.parse(row.takeProfit as string),
    reasoning: row.reasoning as string,
    status: row.status as PlanStatus,
  };
}

/**
 * Creates a new plan in the database
 */
export function createPlan(
  plan: Omit<Plan, "id" | "createdAt">
): Plan {
  const db = getDatabase();

  const id = generatePlanId();
  const createdAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO plans (id, createdAt, symbol, direction, strategy, allocation, entry, dca, stopLoss, takeProfit, reasoning, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    createdAt,
    plan.symbol,
    plan.direction,
    plan.strategy,
    JSON.stringify(plan.allocation),
    JSON.stringify(plan.entry),
    plan.dca ? JSON.stringify(plan.dca) : null,
    JSON.stringify(plan.stopLoss),
    JSON.stringify(plan.takeProfit),
    plan.reasoning,
    plan.status
  );

  return {
    ...plan,
    id,
    createdAt,
  };
}

/**
 * Gets a plan by ID
 */
export function getPlan(id: string): Plan | null {
  const db = getDatabase();

  const stmt = db.prepare("SELECT * FROM plans WHERE id = ?");
  const row = stmt.get(id) as Record<string, unknown> | null;

  if (!row) {
    return null;
  }

  return rowToPlan(row);
}

/**
 * Updates a plan with partial data
 */
export function updatePlan(id: string, updates: Partial<Plan>): Plan {
  const db = getDatabase();

  const existing = getPlan(id);
  if (!existing) {
    throw new Error(`Plan not found: ${id}`);
  }

  const updated: Plan = { ...existing, ...updates };

  const stmt = db.prepare(`
    UPDATE plans
    SET symbol = ?, direction = ?, strategy = ?, allocation = ?, entry = ?, dca = ?, stopLoss = ?, takeProfit = ?, reasoning = ?, status = ?
    WHERE id = ?
  `);

  stmt.run(
    updated.symbol,
    updated.direction,
    updated.strategy,
    JSON.stringify(updated.allocation),
    JSON.stringify(updated.entry),
    updated.dca ? JSON.stringify(updated.dca) : null,
    JSON.stringify(updated.stopLoss),
    JSON.stringify(updated.takeProfit),
    updated.reasoning,
    updated.status,
    id
  );

  return updated;
}

/**
 * Lists plans with optional status filter
 */
export function listPlans(filter?: { status?: PlanStatus }): Plan[] {
  const db = getDatabase();

  let query = "SELECT * FROM plans";
  const params: string[] = [];

  if (filter?.status) {
    query += " WHERE status = ?";
    params.push(filter.status);
  }

  query += " ORDER BY createdAt DESC";

  const stmt = db.prepare(query);
  const rows = (params.length > 0 ? stmt.all(...params) : stmt.all()) as Record<string, unknown>[];

  return rows.map(rowToPlan);
}
