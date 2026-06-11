import { createHash } from "node:crypto";
import { getDatabase } from "../database.ts";
// Imported from structured.ts directly (not the observability barrel) because
// the barrel re-exports metrics.ts, which imports this module — a cycle.
import { recordStructuredObservation } from "../../platform/observability/structured.ts";
import type { Plan, PlanStatus } from "../../../types/index.ts";

/**
 * Generates a unique plan ID
 */
function generatePlanId(): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `pln_${random}`;
}

// Migration: approvedContentHash column (approve→execute content binding).
// Lazy + idempotent so pre-existing databases pick it up on first use.
let approvedContentHashColumnEnsured = false;

function getPlansDb(): ReturnType<typeof getDatabase> {
  const db = getDatabase();
  if (!approvedContentHashColumnEnsured) {
    try {
      db.run("ALTER TABLE plans ADD COLUMN approvedContentHash TEXT");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate column/i.test(msg)) {
        throw err;
      }
    }
    approvedContentHashColumnEnsured = true;
  }
  return db;
}

/**
 * Canonical content hash over the trade-relevant plan fields ONLY (what would
 * actually be traded: instrument, side, entry, size, stop, TPs, routing).
 * Timestamps, status, reasoning and other metadata are deliberately excluded
 * so an approval binds to trade content, not bookkeeping. Fields are projected
 * explicitly to fix key order, making the hash stable across JSON round-trips.
 */
export function computePlanContentHash(plan: Plan): string {
  const content = {
    symbol: plan.symbol,
    direction: plan.direction,
    strategy: plan.strategy,
    allocation: {
      currency: plan.allocation.currency,
      amount: plan.allocation.amount,
      percentOfPortfolio: plan.allocation.percentOfPortfolio,
    },
    entry: { type: plan.entry.type, price: plan.entry.price },
    dca: plan.dca
      ? plan.dca.map((l) => ({ price: l.price, percentOfAllocation: l.percentOfAllocation }))
      : null,
    grid: plan.grid
      ? {
          levels: plan.grid.levels.map((l) => ({
            price: l.price,
            percentOfAllocation: l.percentOfAllocation,
          })),
          distribution: plan.grid.distribution,
          priceRange: { high: plan.grid.priceRange.high, low: plan.grid.priceRange.low },
        }
      : null,
    stopLoss: { price: plan.stopLoss.price },
    takeProfit: plan.takeProfit.map((tp) => ({
      price: tp.price,
      percentToSell: tp.percentToSell,
    })),
    routingPolicy: plan.routingPolicy ?? null,
  };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

/**
 * Stores the content hash captured at approval time. execute_plan recomputes
 * and compares — a mismatch means the plan was mutated after approval.
 */
export function setApprovedContentHash(id: string, hash: string): void {
  const db = getPlansDb();
  db.prepare("UPDATE plans SET approvedContentHash = ? WHERE id = ?").run(hash, id);
}

export function getApprovedContentHash(id: string): string | null {
  const db = getPlansDb();
  const row = db.prepare("SELECT approvedContentHash FROM plans WHERE id = ?").get(id) as
    | { approvedContentHash?: string | null }
    | null;
  return row?.approvedContentHash ?? null;
}

/**
 * Converts a database row to a Plan object
 */
function rowToPlan(row: Record<string, unknown>): Plan {
  return {
    id: row.id as string,
    createdAt: row.createdAt as string,
    expiresAt: row.expiresAt as string | undefined,
    symbol: row.symbol as string,
    direction: row.direction as "long",
    strategy: row.strategy as "support_bounce" | "grid_entry",
    allocation: JSON.parse(row.allocation as string),
    entry: JSON.parse(row.entry as string),
    dca: row.dca ? JSON.parse(row.dca as string) : null,
    grid: row.grid ? JSON.parse(row.grid as string) : null,
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
  const db = getPlansDb();

  const id = generatePlanId();
  const createdAt = new Date().toISOString();
  // Default expiration to 24 hours from now if not provided
  const expiresAt = plan.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const stmt = db.prepare(`
    INSERT INTO plans (id, createdAt, expiresAt, symbol, direction, strategy, allocation, entry, dca, grid, stopLoss, takeProfit, reasoning, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    createdAt,
    expiresAt,
    plan.symbol,
    plan.direction,
    plan.strategy,
    JSON.stringify(plan.allocation),
    JSON.stringify(plan.entry),
    plan.dca ? JSON.stringify(plan.dca) : null,
    plan.grid ? JSON.stringify(plan.grid) : null,
    JSON.stringify(plan.stopLoss),
    JSON.stringify(plan.takeProfit),
    plan.reasoning,
    plan.status
  );

  return {
    ...plan,
    id,
    createdAt,
    expiresAt,
  };
}

/**
 * Gets a plan by ID
 */
export function getPlan(id: string): Plan | null {
  const db = getPlansDb();

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
  const db = getPlansDb();

  const existing = getPlan(id);
  if (!existing) {
    throw new Error(`Plan not found: ${id}`);
  }

  const updated: Plan = { ...existing, ...updates };

  // Approval content binding: changing any trade-relevant field on an
  // APPROVED plan voids the approval. Demote to DRAFT (re-approval required)
  // and clear the stored approval hash — fail closed even if the caller
  // tried to set a status of its own in the same update.
  const demoted =
    existing.status === "APPROVED" &&
    computePlanContentHash(existing) !== computePlanContentHash(updated);
  if (demoted) {
    updated.status = "DRAFT";
  }

  const stmt = db.prepare(`
    UPDATE plans
    SET symbol = ?, direction = ?, strategy = ?, allocation = ?, entry = ?, dca = ?, grid = ?, stopLoss = ?, takeProfit = ?, reasoning = ?, status = ?, expiresAt = ?
    WHERE id = ?
  `);

  stmt.run(
    updated.symbol,
    updated.direction,
    updated.strategy,
    JSON.stringify(updated.allocation),
    JSON.stringify(updated.entry),
    updated.dca ? JSON.stringify(updated.dca) : null,
    updated.grid ? JSON.stringify(updated.grid) : null,
    JSON.stringify(updated.stopLoss),
    JSON.stringify(updated.takeProfit),
    updated.reasoning,
    updated.status,
    updated.expiresAt ?? null,
    id
  );

  if (demoted) {
    db.prepare("UPDATE plans SET approvedContentHash = NULL WHERE id = ?").run(id);
    recordStructuredObservation({
      eventType: "plan.approval_demoted",
      workflow: "execution",
      source: "storage",
      component: "plans_store",
      outcome: "info",
      status: "content_changed_after_approval",
      planId: id,
      symbol: updated.symbol,
      reason:
        "Trade-relevant plan fields changed after approval — demoted to DRAFT; re-approval required before execution.",
    });
  }

  return updated;
}

/**
 * Lists plans with optional status filter
 */
export function listPlans(filter?: { status?: PlanStatus }): Plan[] {
  const db = getPlansDb();

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
