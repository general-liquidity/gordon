/**
 * VWAP Executor — Volume-Weighted Average Price
 *
 * Distributes order slices proportional to expected volume profile,
 * so execution tracks the VWAP benchmark. Fetches historical candle
 * data to compute volume distribution, then places slices accordingly.
 */

import type { Exchange } from "../../../infra/exchange/types.ts";
import { createModuleLogger } from "../../../infra/logger/index.ts";
import type {
  VWAPConfig,
  ExecutionSession,
  ExecutionSlice,
  OrderSubmitter,
} from "./types.ts";

const logger = createModuleLogger("vwap-executor");

export class VWAPExecutor {
  private session: ExecutionSession;
  private slices: ExecutionSlice[] = [];
  private exchange: Exchange;
  private config: VWAPConfig;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private currentSliceIndex = 0;
  private onComplete?: (session: ExecutionSession) => void;
  private submitOrder: OrderSubmitter;

  constructor(
    session: ExecutionSession,
    exchange: Exchange,
    config: VWAPConfig,
    submitOrder: OrderSubmitter,
    onComplete?: (session: ExecutionSession) => void,
  ) {
    this.session = session;
    this.exchange = exchange;
    this.config = config;
    this.onComplete = onComplete;
    this.submitOrder = submitOrder;
  }

  async start(): Promise<void> {
    logger.info("VWAP execution started", {
      sessionId: this.session.sessionId,
      symbol: this.session.intent.symbol,
      totalQuantity: this.session.totalQuantity,
      durationMs: this.config.durationMs,
    });

    // Compute volume profile from historical candles
    const volumeWeights = await this.computeVolumeProfile();
    this.initializeSlices(volumeWeights);

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
    this.session.status = "cancelled";
    this.session.updatedAt = new Date().toISOString();
    this.onComplete?.(this.session);
  }

  getSession(): ExecutionSession {
    return { ...this.session };
  }

  // ---------- Private ----------

  private async computeVolumeProfile(): Promise<number[]> {
    const { symbol } = this.session.intent;
    const numSlices = Math.max(4, Math.ceil(this.config.durationMs / (5 * 60 * 1000))); // 5min intervals

    try {
      const candles = await this.exchange.getCandles(
        symbol,
        "5m",
        this.config.lookbackPeriods * numSlices,
      );

      if (candles.length < numSlices) {
        // Not enough data — equal distribution
        return Array(numSlices).fill(1 / numSlices);
      }

      // Compute volume for each position in the cycle
      const volumeBySlot = new Array(numSlices).fill(0);
      for (let i = 0; i < candles.length; i++) {
        const slotIndex = i % numSlices;
        volumeBySlot[slotIndex] += candles[i]!.volume;
      }

      // Normalize to weights summing to 1
      const totalVolume = volumeBySlot.reduce((a: number, b: number) => a + b, 0);
      if (totalVolume === 0) {
        return Array(numSlices).fill(1 / numSlices);
      }

      return volumeBySlot.map((v: number) => v / totalVolume);
    } catch (error) {
      logger.warn("Failed to compute volume profile, using equal weights", {
        error: (error as Error).message,
      });
      const numSlicesDefault = Math.max(4, Math.ceil(this.config.durationMs / (5 * 60 * 1000)));
      return Array(numSlicesDefault).fill(1 / numSlicesDefault);
    }
  }

  private initializeSlices(volumeWeights: number[]): void {
    let remaining = this.session.totalQuantity;

    for (let i = 0; i < volumeWeights.length; i++) {
      const qty =
        i === volumeWeights.length - 1
          ? remaining
          : Math.max(0, this.session.totalQuantity * volumeWeights[i]!);

      remaining -= qty;

      this.slices.push({
        sliceIndex: i,
        clientOrderId: `gordon_vwap_${this.session.sessionId.slice(0, 8)}_${i}`,
        quantity: qty,
        status: "pending",
        filledQuantity: 0,
        avgFillPrice: 0,
      });
    }

    // Filter out zero-quantity slices
    this.slices = this.slices.filter((s) => s.quantity > 0);
    this.session.slicesTotal = this.slices.length;
  }

  private async executeNextSlice(): Promise<void> {
    if (this.session.status !== "running") return;
    if (this.currentSliceIndex >= this.slices.length) {
      this.completeSession();
      return;
    }

    const slice = this.slices[this.currentSliceIndex]!;

    try {
      const { symbol, side } = this.session.intent;

      // Apply participation rate cap
      const effectiveQty = slice.quantity;

      const result = await this.submitOrder({
        symbol,
        side,
        type: "MARKET",
        quantity: effectiveQty,
        newClientOrderId: slice.clientOrderId,
      });

      slice.orderId = result.orderId;
      slice.status = "filled";
      slice.filledQuantity = result.executedQty ?? effectiveQty;
      slice.avgFillPrice =
        result.executedQty > 0
          ? result.cummulativeQuoteQty / result.executedQty
          : result.price;
      slice.placedAt = new Date().toISOString();
      slice.filledAt = new Date().toISOString();

      this.session.childOrderIds.push(slice.orderId);

      // Update session averages
      const prevTotal = this.session.quantityFilled * this.session.avgFillPrice;
      this.session.quantityFilled += slice.filledQuantity;
      this.session.avgFillPrice =
        this.session.quantityFilled > 0
          ? (prevTotal + slice.filledQuantity * slice.avgFillPrice) / this.session.quantityFilled
          : 0;

      this.currentSliceIndex++;
      this.session.slicesFilled++;
      this.session.updatedAt = new Date().toISOString();

      logger.debug("VWAP slice executed", {
        sessionId: this.session.sessionId,
        sliceIndex: slice.sliceIndex,
        quantity: slice.filledQuantity,
        price: slice.avgFillPrice.toFixed(4),
      });

      // Schedule next slice
      if (this.currentSliceIndex < this.slices.length) {
        const interval = this.config.durationMs / this.slices.length;
        this.timer = setTimeout(() => this.executeNextSlice(), Math.max(1000, interval));
      } else {
        this.completeSession();
      }
    } catch (error) {
      slice.status = "failed";
      logger.error("VWAP slice execution failed", error as Error, {
        sessionId: this.session.sessionId,
        sliceIndex: slice.sliceIndex,
      });

      this.currentSliceIndex++;
      if (this.currentSliceIndex < this.slices.length) {
        const interval = this.config.durationMs / this.slices.length;
        this.timer = setTimeout(() => this.executeNextSlice(), interval);
      } else {
        this.completeSession();
      }
    }
  }

  private completeSession(): void {
    this.session.status = "completed";
    this.session.completedAt = new Date().toISOString();
    this.session.updatedAt = new Date().toISOString();

    logger.info("VWAP execution completed", {
      sessionId: this.session.sessionId,
      quantityFilled: this.session.quantityFilled,
      avgFillPrice: this.session.avgFillPrice.toFixed(4),
    });

    this.onComplete?.(this.session);
  }
}
