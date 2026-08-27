/**
 * POV Executor — Percentage of Volume.
 *
 * Tracks realized market volume in real time and sizes each child
 * order to stay near a configured participation rate. Distinct from
 * VWAP (schedule fixed up front from historical volume profile) and
 * TWAP (schedule fixed up front from clock time).
 *
 * POV is the institutional default when the operator wants "trade
 * X% of the tape until done, but don't push past Y%". It naturally
 * adapts to surprise volume — if the tape thickens, POV pushes more;
 * if it thins, POV pulls back.
 *
 * Reference: Kissell, "Algorithmic Trading Methods" (2nd ed., 2020),
 * ch. 14-15.
 */

import type { Exchange } from "../../../infra/exchange/types.ts";
import { createModuleLogger } from "../../../infra/logger/index.ts";
import type { POVConfig, ExecutionSession, ExecutionSlice, OrderSubmitter } from "./types.ts";

const logger = createModuleLogger("pov-executor");

const DEFAULT_POLL_INTERVAL_MS = 30_000;

export class POVExecutor {
  private session: ExecutionSession;
  private slices: ExecutionSlice[] = [];
  private exchange: Exchange;
  private config: POVConfig;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextSliceIndex = 0;
  private lastObservedCloseTime: number | null = null;
  private onComplete?: (session: ExecutionSession) => void;
  private startTimeMs: number;
  private submitOrder: OrderSubmitter;

  constructor(
    session: ExecutionSession,
    exchange: Exchange,
    config: POVConfig,
    submitOrder: OrderSubmitter,
    onComplete?: (session: ExecutionSession) => void,
  ) {
    this.session = session;
    this.exchange = exchange;
    this.config = config;
    this.onComplete = onComplete;
    this.startTimeMs = Date.now();
    this.submitOrder = submitOrder;
  }

  async start(): Promise<void> {
    logger.info("POV execution started", {
      sessionId: this.session.sessionId,
      symbol: this.session.intent.symbol,
      totalQuantity: this.session.totalQuantity,
      targetRate: this.config.targetParticipationRate,
      maxRate: this.config.maxParticipationRate,
    });

    this.session.status = "running";
    this.session.slicesTotal = 0;

    await this.tick();
  }

  async pause(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.session.status = "paused";
    this.session.updatedAt = new Date().toISOString();
  }

  async resume(): Promise<void> {
    if (this.session.status !== "paused") return;
    this.session.status = "running";
    await this.tick();
  }

  async cancel(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.session.status = "cancelled";
    this.session.updatedAt = new Date().toISOString();
    this.onComplete?.(this.session);
  }

  getSession(): ExecutionSession {
    return { ...this.session };
  }

  // ---------- Private ----------

  private async tick(): Promise<void> {
    if (this.session.status !== "running") return;

    const remaining = this.session.totalQuantity - this.session.quantityFilled;
    if (remaining <= 0) {
      this.completeSession();
      return;
    }

    if (
      this.config.maxDurationMs > 0 &&
      Date.now() - this.startTimeMs > this.config.maxDurationMs
    ) {
      logger.warn("POV max duration reached, terminating", {
        sessionId: this.session.sessionId,
        filled: this.session.quantityFilled,
        target: this.session.totalQuantity,
      });
      this.completeSession();
      return;
    }

    const recentVolume = await this.observeRecentVolume();
    const targetQty = recentVolume * (this.config.targetParticipationRate / 100);
    const maxQty = recentVolume * (this.config.maxParticipationRate / 100);
    const desiredQty = Math.min(targetQty, maxQty, remaining);

    if (desiredQty <= 0 || desiredQty < this.config.minSliceQuantity) {
      this.scheduleNextTick();
      return;
    }

    await this.executeSlice(desiredQty);
    this.scheduleNextTick();
  }

  private async observeRecentVolume(): Promise<number> {
    const { symbol } = this.session.intent;
    try {
      const candles = await this.exchange.getCandles(symbol, "1m", 5);
      if (candles.length === 0) return 0;

      // First call: count all returned candles' volume.
      // Subsequent calls: count only candles newer than the last seen.
      if (this.lastObservedCloseTime === null) {
        this.lastObservedCloseTime = candles[candles.length - 1]!.closeTime;
        return candles.reduce((sum, c) => sum + c.volume, 0);
      }

      const lastSeen = this.lastObservedCloseTime;
      const fresh = candles.filter((c) => c.closeTime > lastSeen);
      if (fresh.length === 0) return 0;

      this.lastObservedCloseTime = fresh[fresh.length - 1]!.closeTime;
      return fresh.reduce((sum, c) => sum + c.volume, 0);
    } catch (error) {
      logger.warn("POV volume observation failed", {
        error: (error as Error).message,
      });
      return 0;
    }
  }

  private async executeSlice(quantity: number): Promise<void> {
    const sliceIndex = this.nextSliceIndex++;
    const { symbol, side } = this.session.intent;
    const slice: ExecutionSlice = {
      sliceIndex,
      clientOrderId: `gordon_pov_${this.session.sessionId.slice(0, 8)}_${sliceIndex}`,
      quantity,
      status: "pending",
      filledQuantity: 0,
      avgFillPrice: 0,
    };
    this.slices.push(slice);
    this.session.slicesTotal = this.slices.length;

    try {
      const result = await this.submitOrder({
        symbol,
        side,
        type: this.config.orderType,
        quantity,
        newClientOrderId: slice.clientOrderId,
      });

      slice.orderId = result.orderId;
      slice.status = "filled";
      slice.filledQuantity = result.executedQty ?? quantity;
      slice.avgFillPrice =
        result.executedQty > 0 ? result.cummulativeQuoteQty / result.executedQty : result.price;
      slice.placedAt = new Date().toISOString();
      slice.filledAt = new Date().toISOString();

      this.session.childOrderIds.push(slice.orderId);

      const prevTotal = this.session.quantityFilled * this.session.avgFillPrice;
      this.session.quantityFilled += slice.filledQuantity;
      this.session.avgFillPrice =
        this.session.quantityFilled > 0
          ? (prevTotal + slice.filledQuantity * slice.avgFillPrice) / this.session.quantityFilled
          : 0;

      this.session.slicesFilled++;
      this.session.updatedAt = new Date().toISOString();

      logger.debug("POV slice executed", {
        sessionId: this.session.sessionId,
        sliceIndex,
        quantity: slice.filledQuantity,
        price: slice.avgFillPrice.toFixed(4),
      });
    } catch (error) {
      slice.status = "failed";
      logger.error("POV slice execution failed", error as Error, {
        sessionId: this.session.sessionId,
        sliceIndex,
      });
    }
  }

  private scheduleNextTick(): void {
    if (this.session.status !== "running") return;
    const interval = Math.max(1000, this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    this.timer = setTimeout(() => this.tick(), interval);
  }

  private completeSession(): void {
    this.session.status = "completed";
    this.session.completedAt = new Date().toISOString();
    this.session.updatedAt = new Date().toISOString();

    logger.info("POV execution completed", {
      sessionId: this.session.sessionId,
      quantityFilled: this.session.quantityFilled,
      avgFillPrice: this.session.avgFillPrice.toFixed(4),
    });

    this.onComplete?.(this.session);
  }
}
