/**
 * Execution Algorithm Types
 *
 * Shared types for TWAP, VWAP, and Iceberg algorithmic execution.
 */

import { z } from "zod";
import type { Order, OrderParams } from "../../../infra/exchange/types.ts";

// ============================================================================
// Algorithm Enum
// ============================================================================

export const ExecutionAlgorithmSchema = z.enum(["TWAP", "VWAP", "ICEBERG", "POV"]);
export type ExecutionAlgorithm = z.infer<typeof ExecutionAlgorithmSchema>;

// ============================================================================
// Algorithm Configs
// ============================================================================

export interface TWAPConfig {
  durationMs: number;
  slices: number;
  randomizePercent: number;
  orderType: "MARKET" | "LIMIT";
  limitOffsetBps?: number;
}

export interface VWAPConfig {
  durationMs: number;
  volumeProfile: "HISTORICAL" | "REALTIME";
  lookbackPeriods: number;
  participationRate: number;
}

export interface IcebergConfig {
  showRatio: number;
  randomizePercent: number;
  priceType: "LIMIT" | "MARKET";
  limitOffsetBps?: number;
}

export interface POVConfig {
  /** Target % of observed market volume to take per tick (e.g. 10 = 10%). */
  targetParticipationRate: number;
  /** Hard cap — never exceed this fraction of observed volume (e.g. 20). */
  maxParticipationRate: number;
  /** How often to observe volume and place a child slice (ms). Default 30_000. */
  pollIntervalMs: number;
  /** Hard ceiling on total runtime; 0 = no cap. */
  maxDurationMs: number;
  /** Skip ticks that would produce a slice smaller than this. */
  minSliceQuantity: number;
  /** Order type for child slices. */
  orderType: "MARKET" | "LIMIT";
  /** If orderType=LIMIT, offset from mid in bps. */
  limitOffsetBps?: number;
}

// ============================================================================
// Execution Intent
// ============================================================================

export interface ExecutionIntent {
  algorithm: ExecutionAlgorithm;
  symbol: string;
  side: "BUY" | "SELL";
  totalQuantity: number;
  config: TWAPConfig | VWAPConfig | IcebergConfig | POVConfig;
}

export type OrderSubmitter = (params: OrderParams) => Promise<Order>;

// ============================================================================
// Execution Session
// ============================================================================

export type ExecutionSessionStatus = "running" | "paused" | "completed" | "cancelled" | "failed";

export interface ExecutionSession {
  sessionId: string;
  intent: ExecutionIntent;
  status: ExecutionSessionStatus;
  slicesFilled: number;
  slicesTotal: number;
  quantityFilled: number;
  totalQuantity: number;
  avgFillPrice: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  childOrderIds: string[];
}

// ============================================================================
// Slice Record
// ============================================================================

export interface ExecutionSlice {
  sliceIndex: number;
  orderId?: string;
  clientOrderId: string;
  quantity: number;
  price?: number;
  status: "pending" | "placed" | "filled" | "cancelled" | "failed";
  filledQuantity: number;
  avgFillPrice: number;
  placedAt?: string;
  filledAt?: string;
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_TWAP_CONFIG: TWAPConfig = {
  durationMs: 60 * 60 * 1000, // 1 hour
  slices: 12,
  randomizePercent: 10,
  orderType: "MARKET",
};

export const DEFAULT_VWAP_CONFIG: VWAPConfig = {
  durationMs: 4 * 60 * 60 * 1000, // 4 hours
  volumeProfile: "HISTORICAL",
  lookbackPeriods: 24,
  participationRate: 10,
};

export const DEFAULT_ICEBERG_CONFIG: IcebergConfig = {
  showRatio: 0.1,
  randomizePercent: 20,
  priceType: "LIMIT",
  limitOffsetBps: 5,
};

export const DEFAULT_POV_CONFIG: POVConfig = {
  targetParticipationRate: 10,
  maxParticipationRate: 20,
  pollIntervalMs: 30_000,
  maxDurationMs: 4 * 60 * 60 * 1000,
  minSliceQuantity: 0,
  orderType: "MARKET",
};
