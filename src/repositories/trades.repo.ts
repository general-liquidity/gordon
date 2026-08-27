/**
 * Trades Repository
 * Data access for trades
 */

import { BaseRepository, type QueryOptions } from "./base.ts";
import type { Trade, TradeStatus } from "../types/index.ts";

/**
 * Repository for Trade entities
 */
export class TradesRepository extends BaseRepository<Trade> {
  constructor() {
    super("trades", "Trade");
  }

  protected rowToEntity(row: Record<string, unknown>): Trade {
    return {
      id: row.id as string,
      planId: row.planId as string,
      openedAt: row.openedAt as string,
      closedAt: (row.closedAt as string) || null,
      symbol: row.symbol as string,
      entries: JSON.parse(row.entries as string),
      exits: JSON.parse(row.exits as string),
      averageEntry: row.averageEntry as number,
      realizedPnl: row.realizedPnl as number,
      realizedPnlPercent: row.realizedPnlPercent as number,
      status: row.status as TradeStatus,
    };
  }

  protected entityToRow(entity: Trade): Record<string, unknown> {
    return {
      id: entity.id,
      planId: entity.planId,
      openedAt: entity.openedAt,
      closedAt: entity.closedAt || null,
      symbol: entity.symbol,
      entries: JSON.stringify(entity.entries),
      exits: JSON.stringify(entity.exits),
      averageEntry: entity.averageEntry,
      realizedPnl: entity.realizedPnl,
      realizedPnlPercent: entity.realizedPnlPercent,
      status: entity.status,
    };
  }

  /**
   * Find trades by status
   */
  findByStatus(status: TradeStatus, options?: QueryOptions): Trade[] {
    return this.findWhere({ status } as Partial<Record<keyof Trade, unknown>>, {
      orderBy: "openedAt",
      orderDir: "DESC",
      ...options,
    });
  }

  /**
   * Find open trades
   */
  findOpen(options?: QueryOptions): Trade[] {
    return this.findByStatus("OPEN", options);
  }

  /**
   * Find closed trades
   */
  findClosed(options?: QueryOptions): Trade[] {
    return this.findByStatus("CLOSED", options);
  }

  /**
   * Find trades by symbol
   */
  findBySymbol(symbol: string, options?: QueryOptions): Trade[] {
    return this.findWhere(
      { symbol: symbol.toUpperCase() } as Partial<Record<keyof Trade, unknown>>,
      {
        orderBy: "openedAt",
        orderDir: "DESC",
        ...options,
      },
    );
  }

  /**
   * Find trade by plan ID
   */
  findByPlanId(planId: string): Trade | null {
    const trades = this.findWhere({ planId } as Partial<Record<keyof Trade, unknown>>, {
      limit: 1,
    });
    return trades[0] || null;
  }

  /**
   * Update trade status
   */
  updateStatus(id: string, status: TradeStatus, closedAt?: string): Trade {
    const updates: Partial<Trade> = { status };
    if (closedAt) {
      updates.closedAt = closedAt;
    }
    return this.update(id, updates);
  }

  /**
   * Update trade PnL
   */
  updatePnl(id: string, pnl: number, pnlPercent: number): Trade {
    return this.update(id, {
      realizedPnl: pnl,
      realizedPnlPercent: pnlPercent,
    } as Partial<Trade>);
  }

  /**
   * Get trade statistics
   */
  getStats(): {
    totalTrades: number;
    openTrades: number;
    closedTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPnl: number;
    winRate: number;
  } {
    const allTrades = this.findAll();
    const closedTrades = allTrades.filter((t) => t.status === "CLOSED");
    const winningTrades = closedTrades.filter((t) => t.realizedPnl > 0);
    const losingTrades = closedTrades.filter((t) => t.realizedPnl < 0);
    const totalPnl = closedTrades.reduce((sum, t) => sum + t.realizedPnl, 0);

    return {
      totalTrades: allTrades.length,
      openTrades: allTrades.filter((t) => t.status === "OPEN").length,
      closedTrades: closedTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      totalPnl,
      winRate: closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0,
    };
  }

  /**
   * Get recent trades
   */
  getRecent(limit: number = 10): Trade[] {
    return this.findAll({
      orderBy: "openedAt",
      orderDir: "DESC",
      limit,
    });
  }
}

// Default instance
let defaultRepo: TradesRepository | null = null;

export function getTradesRepository(): TradesRepository {
  if (!defaultRepo) {
    defaultRepo = new TradesRepository();
  }
  return defaultRepo;
}
