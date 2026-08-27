/**
 * Plans Repository
 * Data access for trading plans
 */

import { BaseRepository, type QueryOptions } from "./base.ts";
import type { Plan, PlanStatus } from "../types/index.ts";

/**
 * Repository for Plan entities
 */
export class PlansRepository extends BaseRepository<Plan> {
  constructor() {
    super("plans", "Plan");
  }

  protected rowToEntity(row: Record<string, unknown>): Plan {
    return {
      id: row.id as string,
      createdAt: row.createdAt as string,
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

  protected entityToRow(entity: Plan): Record<string, unknown> {
    return {
      id: entity.id,
      createdAt: entity.createdAt,
      symbol: entity.symbol,
      direction: entity.direction,
      strategy: entity.strategy,
      allocation: JSON.stringify(entity.allocation),
      entry: JSON.stringify(entity.entry),
      dca: entity.dca ? JSON.stringify(entity.dca) : null,
      stopLoss: JSON.stringify(entity.stopLoss),
      takeProfit: JSON.stringify(entity.takeProfit),
      reasoning: entity.reasoning,
      status: entity.status,
    };
  }

  /**
   * Find plans by status
   */
  findByStatus(status: PlanStatus, options?: QueryOptions): Plan[] {
    return this.findWhere({ status } as Partial<Record<keyof Plan, unknown>>, {
      orderBy: "createdAt",
      orderDir: "DESC",
      ...options,
    });
  }

  /**
   * Find plans by symbol
   */
  findBySymbol(symbol: string, options?: QueryOptions): Plan[] {
    return this.findWhere(
      { symbol: symbol.toUpperCase() } as Partial<Record<keyof Plan, unknown>>,
      {
        orderBy: "createdAt",
        orderDir: "DESC",
        ...options,
      },
    );
  }

  /**
   * Find active plans (DRAFT or APPROVED)
   */
  findActive(options?: QueryOptions): Plan[] {
    const stmt = this.db.prepare(`
      SELECT * FROM ${this.tableName}
      WHERE status IN ('DRAFT', 'APPROVED')
      ORDER BY createdAt DESC
      ${options?.limit ? `LIMIT ${options.limit}` : ""}
    `);

    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToEntity(row));
  }

  /**
   * Update plan status
   */
  updateStatus(id: string, status: PlanStatus): Plan {
    return this.update(id, { status } as Partial<Plan>);
  }

  /**
   * Get recent plans
   */
  getRecent(limit: number = 10): Plan[] {
    return this.findAll({
      orderBy: "createdAt",
      orderDir: "DESC",
      limit,
    });
  }
}

// Default instance
let defaultRepo: PlansRepository | null = null;

export function getPlansRepository(): PlansRepository {
  if (!defaultRepo) {
    defaultRepo = new PlansRepository();
  }
  return defaultRepo;
}
