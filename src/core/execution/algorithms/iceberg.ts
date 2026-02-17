/**
 * Iceberg Executor
 *
 * Hides total order size by showing only a small visible portion.
 * On each fill, replenishes with a new order (randomized size).
 * Continues until total quantity is filled.
 */

import type { Exchange } from "../../../infra/exchange/types.ts";
import { createModuleLogger } from "../../../infra/logger/index.ts";
import type {
  IcebergConfig,
  ExecutionSession,
  ExecutionSlice,
} from "./types.ts";

const logger = createModuleLogger("iceberg-executor");

export class IcebergExecutor {
  private session: ExecutionSession;
  private slices: ExecutionSlice[] = [];
  private exchange: Exchange;
  private config: IcebergConfig;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private sliceCounter = 0;
  private onComplete?: (session: ExecutionSession) => void;

  constructor(
    session: ExecutionSession,
    exchange: Exchange,
    config: IcebergConfig,
    onComplete?: (session: ExecutionSession) => void,
  ) {
    this.session = session;
    this.exchange = exchange;
    this.config = config;
    this.onComplete = onComplete;
  }

  async start(): Promise<void> {
    logger.info("Iceberg execution started", {
      sessionId: this.session.sessionId,
      symbol: this.session.intent.symbol,
      totalQuantity: this.session.totalQuantity,
      showRatio: this.config.showRatio,
    });

    this.session.status = "running";
    await this.placeVisiblePortion();
  }

  async pause(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.session.status = "paused";
    this.session.updatedAt = new Date().toISOString();
  }

  async resume(): Promise<void> {
    if (this.session.status !== "paused") return;
    this.session.status = "running";
    await this.placeVisiblePortion();
  }

  async cancel(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Cancel the active visible order
    const activeSlice = this.slices.find((s) => s.status === "placed");
    if (activeSlice?.orderId) {
      try {
        await this.exchange.cancelOrder(this.session.intent.symbol, activeSlice.orderId);
        activeSlice.status = "cancelled";
      } catch (error) {
        logger.warn("Failed to cancel iceberg slice", {
          error: (error as Error).message,
        });
      }
    }

    this.session.status = "cancelled";
    this.session.updatedAt = new Date().toISOString();
    this.onComplete?.(this.session);
  }

  getSession(): ExecutionSession {
    return { ...this.session };
  }

  // ---------- Private ----------

  private async placeVisiblePortion(): Promise<void> {
    if (this.session.status !== "running") return;

    const remaining = this.session.totalQuantity - this.session.quantityFilled;
    if (remaining <= 0) {
      this.completeSession();
      return;
    }

    // Calculate visible portion with randomization
    const baseVisible = this.session.totalQuantity * this.config.showRatio;
    const jitter = baseVisible * (this.config.randomizePercent / 100);
    const visibleQty = Math.min(
      remaining,
      baseVisible + (Math.random() * 2 - 1) * jitter,
    );

    const slice: ExecutionSlice = {
      sliceIndex: this.sliceCounter++,
      clientOrderId: `gordon_ice_${this.session.sessionId.slice(0, 8)}_${this.sliceCounter}`,
      quantity: visibleQty,
      status: "pending",
      filledQuantity: 0,
      avgFillPrice: 0,
    };
    this.slices.push(slice);

    try {
      const { symbol, side } = this.session.intent;

      if (this.config.priceType === "MARKET") {
        const result = await this.exchange.placeOrder({
          symbol,
          side,
          type: "MARKET",
          quantity: visibleQty,
          newClientOrderId: slice.clientOrderId,
        });

        slice.orderId = result.orderId;
        slice.status = "filled";
        slice.filledQuantity = result.executedQty ?? visibleQty;
        slice.avgFillPrice =
          result.executedQty > 0
            ? result.cummulativeQuoteQty / result.executedQty
            : result.price;
        slice.placedAt = new Date().toISOString();
        slice.filledAt = new Date().toISOString();

        this.session.childOrderIds.push(slice.orderId);
        this.updateSessionAverages(slice);
        this.session.slicesFilled++;
        this.session.slicesTotal++;
        this.session.updatedAt = new Date().toISOString();

        logger.debug("Iceberg slice filled (market)", {
          sessionId: this.session.sessionId,
          sliceIndex: slice.sliceIndex,
          quantity: slice.filledQuantity,
          remaining: this.session.totalQuantity - this.session.quantityFilled,
        });

        // Immediately place next portion (with small delay to appear natural)
        const delay = 1000 + Math.random() * 4000; // 1-5 seconds
        this.pollTimer = setTimeout(() => this.placeVisiblePortion(), delay);
      } else {
        // Limit order
        const spread = await this.exchange.getSpread(symbol);
        const offsetMultiplier = side === "BUY" ? -1 : 1;
        const limitPrice =
          (spread.bidPrice + spread.askPrice) / 2 *
          (1 + offsetMultiplier * (this.config.limitOffsetBps ?? 5) / 10000);

        const result = await this.exchange.placeOrder({
          symbol,
          side,
          type: "LIMIT",
          quantity: visibleQty,
          price: limitPrice,
          timeInForce: "GTC",
          newClientOrderId: slice.clientOrderId,
        });

        slice.orderId = result.orderId;
        slice.price = limitPrice;
        slice.status = "placed";
        slice.placedAt = new Date().toISOString();
        this.session.childOrderIds.push(slice.orderId);
        this.session.slicesTotal++;

        // Poll for fill
        this.pollTimer = setTimeout(() => this.pollForFill(slice), 5000);
      }
    } catch (error) {
      slice.status = "failed";
      logger.error("Iceberg slice placement failed", error as Error, {
        sessionId: this.session.sessionId,
      });

      // Retry after delay
      this.pollTimer = setTimeout(() => this.placeVisiblePortion(), 10000);
    }
  }

  private async pollForFill(slice: ExecutionSlice): Promise<void> {
    if (this.session.status !== "running" || !slice.orderId) return;

    try {
      const status = await this.exchange.getOrderStatus(
        this.session.intent.symbol,
        slice.orderId,
      );

      if (status.status === "FILLED") {
        slice.status = "filled";
        slice.filledQuantity = status.executedQty ?? slice.quantity;
        slice.avgFillPrice =
          status.executedQty > 0
            ? status.cummulativeQuoteQty / status.executedQty
            : status.price;
        slice.filledAt = new Date().toISOString();

        this.updateSessionAverages(slice);
        this.session.slicesFilled++;
        this.session.updatedAt = new Date().toISOString();

        // Place next portion
        const delay = 1000 + Math.random() * 4000;
        this.pollTimer = setTimeout(() => this.placeVisiblePortion(), delay);
      } else if (status.status === "CANCELED" || status.status === "EXPIRED") {
        slice.status = "cancelled";
        // Re-place
        this.pollTimer = setTimeout(() => this.placeVisiblePortion(), 2000);
      } else {
        // Still open — poll again
        this.pollTimer = setTimeout(() => this.pollForFill(slice), 5000);
      }
    } catch (error) {
      logger.warn("Iceberg poll failed", { error: (error as Error).message });
      this.pollTimer = setTimeout(() => this.pollForFill(slice), 10000);
    }
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

    logger.info("Iceberg execution completed", {
      sessionId: this.session.sessionId,
      quantityFilled: this.session.quantityFilled,
      avgFillPrice: this.session.avgFillPrice.toFixed(4),
      totalSlices: this.sliceCounter,
    });

    this.onComplete?.(this.session);
  }
}
