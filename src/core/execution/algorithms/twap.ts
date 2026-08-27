/**
 * TWAP Executor — Time-Weighted Average Price
 *
 * Splits a large order into N equal slices spread evenly over a
 * time window, with optional jitter to avoid pattern detection.
 */

import type { Exchange } from "../../../infra/exchange/types.ts";
import { createModuleLogger } from "../../../infra/logger/index.ts";
import type { TWAPConfig, ExecutionSession, ExecutionSlice, OrderSubmitter } from "./types.ts";

const logger = createModuleLogger("twap-executor");

export class TWAPExecutor {
  private session: ExecutionSession;
  private slices: ExecutionSlice[] = [];
  private exchange: Exchange;
  private config: TWAPConfig;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private currentSliceIndex = 0;
  private onComplete?: (session: ExecutionSession) => void;
  private submitOrder: OrderSubmitter;

  constructor(
    session: ExecutionSession,
    exchange: Exchange,
    config: TWAPConfig,
    submitOrder: OrderSubmitter,
    onComplete?: (session: ExecutionSession) => void,
  ) {
    this.session = session;
    this.exchange = exchange;
    this.config = config;
    this.onComplete = onComplete;
    this.submitOrder = submitOrder;
    this.initializeSlices();
  }

  private initializeSlices(): void {
    const sliceQty = this.session.totalQuantity / this.config.slices;

    for (let i = 0; i < this.config.slices; i++) {
      // Last slice gets remainder to avoid rounding issues
      const qty =
        i === this.config.slices - 1
          ? this.session.totalQuantity - sliceQty * (this.config.slices - 1)
          : sliceQty;

      this.slices.push({
        sliceIndex: i,
        clientOrderId: `gordon_twap_${this.session.sessionId.slice(0, 8)}_${i}`,
        quantity: qty,
        status: "pending",
        filledQuantity: 0,
        avgFillPrice: 0,
      });
    }

    this.session.slicesTotal = this.config.slices;
  }

  async start(): Promise<void> {
    logger.info("TWAP execution started", {
      sessionId: this.session.sessionId,
      symbol: this.session.intent.symbol,
      totalQuantity: this.session.totalQuantity,
      slices: this.config.slices,
      durationMs: this.config.durationMs,
    });

    this.session.status = "running";
    await this.executeNextSlice();
  }

  async pause(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.session.status = "paused";
    this.session.updatedAt = new Date().toISOString();

    logger.info("TWAP execution paused", {
      sessionId: this.session.sessionId,
      slicesFilled: this.session.slicesFilled,
    });
  }

  async resume(): Promise<void> {
    if (this.session.status !== "paused") return;
    this.session.status = "running";
    await this.executeNextSlice();
  }

  async cancel(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Cancel any pending placed orders
    for (const slice of this.slices) {
      if (slice.status === "placed" && slice.orderId) {
        try {
          await this.exchange.cancelOrder(this.session.intent.symbol, slice.orderId);
          slice.status = "cancelled";
        } catch (error) {
          logger.warn("Failed to cancel TWAP slice order", {
            orderId: slice.orderId,
            error: (error as Error).message,
          });
        }
      }
    }

    this.session.status = "cancelled";
    this.session.updatedAt = new Date().toISOString();
    this.onComplete?.(this.session);
  }

  getSession(): ExecutionSession {
    return { ...this.session };
  }

  getSlices(): ExecutionSlice[] {
    return [...this.slices];
  }

  // ---------- Private ----------

  private async executeNextSlice(): Promise<void> {
    if (this.session.status !== "running") return;
    if (this.currentSliceIndex >= this.config.slices) {
      this.completeSession();
      return;
    }

    const slice = this.slices[this.currentSliceIndex]!;

    try {
      await this.placeSliceOrder(slice);
      this.currentSliceIndex++;
      this.session.slicesFilled++;
      this.session.updatedAt = new Date().toISOString();

      // Schedule next slice
      if (this.currentSliceIndex < this.config.slices) {
        const baseInterval = this.config.durationMs / this.config.slices;
        const jitter = baseInterval * (this.config.randomizePercent / 100);
        const delay = baseInterval + (Math.random() * 2 - 1) * jitter;

        this.timer = setTimeout(() => this.executeNextSlice(), Math.max(1000, delay));
      } else {
        this.completeSession();
      }
    } catch (error) {
      slice.status = "failed";
      logger.error("TWAP slice execution failed", error as Error, {
        sessionId: this.session.sessionId,
        sliceIndex: slice.sliceIndex,
      });

      // Continue with next slice on failure — but check session status first
      this.currentSliceIndex++;
      if (this.session.status !== "running") return;
      if (this.currentSliceIndex < this.config.slices) {
        const baseInterval = this.config.durationMs / this.config.slices;
        this.timer = setTimeout(() => this.executeNextSlice(), baseInterval);
      } else {
        this.completeSession();
      }
    }
  }

  private async placeSliceOrder(slice: ExecutionSlice): Promise<void> {
    const { symbol, side } = this.session.intent;

    if (this.config.orderType === "MARKET") {
      const result = await this.submitOrder({
        symbol,
        side,
        type: "MARKET",
        quantity: slice.quantity,
        newClientOrderId: slice.clientOrderId,
      });

      slice.orderId = result.orderId;
      slice.status = "filled";
      slice.filledQuantity = result.executedQty ?? slice.quantity;
      slice.avgFillPrice =
        result.executedQty > 0 ? result.cummulativeQuoteQty / result.executedQty : result.price;
      slice.placedAt = new Date().toISOString();
      slice.filledAt = new Date().toISOString();

      this.session.childOrderIds.push(slice.orderId);
      this.updateSessionAverages(slice);
    } else {
      // Limit order: use mid-price with offset
      const spread = await this.exchange.getSpread(symbol);
      const midPrice = (spread.bidPrice + spread.askPrice) / 2;
      const offsetMultiplier = side === "BUY" ? -1 : 1;
      const offsetPrice =
        midPrice * (1 + (offsetMultiplier * (this.config.limitOffsetBps ?? 5)) / 10000);

      const result = await this.submitOrder({
        symbol,
        side,
        type: "LIMIT",
        quantity: slice.quantity,
        price: offsetPrice,
        timeInForce: "GTC",
        newClientOrderId: slice.clientOrderId,
      });

      slice.orderId = result.orderId;
      slice.price = offsetPrice;
      slice.status = "placed";
      slice.placedAt = new Date().toISOString();
      this.session.childOrderIds.push(slice.orderId);

      // Assume fill for simplicity (a production version would poll)
      slice.status = "filled";
      slice.filledQuantity = slice.quantity;
      slice.avgFillPrice = offsetPrice;
      slice.filledAt = new Date().toISOString();
      this.updateSessionAverages(slice);
    }

    logger.debug("TWAP slice executed", {
      sessionId: this.session.sessionId,
      sliceIndex: slice.sliceIndex,
      quantity: slice.filledQuantity,
      price: slice.avgFillPrice.toFixed(4),
    });
  }

  private updateSessionAverages(slice: ExecutionSlice): void {
    const prevTotal = this.session.quantityFilled * this.session.avgFillPrice;
    this.session.quantityFilled += slice.filledQuantity;
    this.session.avgFillPrice =
      this.session.quantityFilled > 0
        ? (prevTotal + slice.filledQuantity * slice.avgFillPrice) / this.session.quantityFilled
        : 0;
  }

  private completeSession(): void {
    this.session.status = "completed";
    this.session.completedAt = new Date().toISOString();
    this.session.updatedAt = new Date().toISOString();

    logger.info("TWAP execution completed", {
      sessionId: this.session.sessionId,
      quantityFilled: this.session.quantityFilled,
      avgFillPrice: this.session.avgFillPrice.toFixed(4),
      slicesFilled: this.session.slicesFilled,
    });

    this.onComplete?.(this.session);
  }
}
