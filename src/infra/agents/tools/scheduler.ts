/**
 * Scheduler Tools
 * Tools for controlling background market scanning
 */

import { tool } from "@openai/agents";
import { z } from "zod";

import {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  updateSchedulerConfig,
  triggerImmediateScan,
} from "../../../core/scheduler.ts";
import type { ToolRunContext } from "./types.ts";
import { errors } from "./types.ts";

// ============================================================================
// Start Scheduler Tool
// ============================================================================

export const startSchedulerTool = tool({
  name: "start_background_scanning",
  description:
    "Start automatic background market scanning at regular intervals. " +
    "Use when the user says 'keep scanning', 'monitor the market', or 'alert me when there's an opportunity'.",
  parameters: z.object({
    intervalMinutes: z
      .number()
      .min(15)
      .max(240)
      .default(60)
      .describe("Minutes between scans (15-240, default: 60)"),
    topN: z
      .number()
      .min(10)
      .max(200)
      .default(50)
      .describe("Number of top coins to scan"),
    minConfidence: z
      .number()
      .min(0.3)
      .max(0.9)
      .default(0.5)
      .describe("Minimum confidence to report opportunities (0.3-0.9)"),
  }),
  async execute({ intervalMinutes, topN, minConfidence }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    const status = getSchedulerStatus();
    if (status.isRunning) {
      return {
        success: false,
        message: "Background scanning is already running.",
        status,
      };
    }

    startScheduler(ctx.binance, {
      intervalMs: intervalMinutes * 60 * 1000,
      scanOptions: {
        topN,
        timeframes: ["1h", "4h"],
      },
      minConfidence,
    });

    return {
      success: true,
      message: `Background scanning started. Will scan every ${intervalMinutes} minutes for opportunities with ${Math.round(minConfidence * 100)}%+ confidence.`,
      status: getSchedulerStatus(),
    };
  },
});

// ============================================================================
// Stop Scheduler Tool
// ============================================================================

export const stopSchedulerTool = tool({
  name: "stop_background_scanning",
  description:
    "Stop automatic background market scanning. " +
    "Use when the user says 'stop scanning', 'stop monitoring', or 'cancel alerts'.",
  parameters: z.object({}),
  async execute() {
    const status = getSchedulerStatus();
    if (!status.isRunning) {
      return {
        success: false,
        message: "Background scanning is not currently running.",
      };
    }

    stopScheduler();

    return {
      success: true,
      message: `Background scanning stopped. Completed ${status.scanCount} scans and found ${status.opportunitiesFound} opportunities.`,
      finalStats: {
        scanCount: status.scanCount,
        opportunitiesFound: status.opportunitiesFound,
      },
    };
  },
});

// ============================================================================
// Get Scheduler Status Tool
// ============================================================================

export const getSchedulerStatusTool = tool({
  name: "get_scanning_status",
  description:
    "Check the status of background market scanning. " +
    "Use when the user asks 'is scanning running?', 'when is the next scan?', or 'scanning status'.",
  parameters: z.object({}),
  async execute() {
    const status = getSchedulerStatus();

    if (!status.isRunning) {
      return {
        isRunning: false,
        message: "Background scanning is not currently running. Say 'keep scanning' to start.",
      };
    }

    const intervalMinutes = status.intervalMs / 60000;

    return {
      isRunning: true,
      message: `Background scanning is active. Scanning every ${intervalMinutes} minutes.`,
      lastScan: status.lastScanTime,
      nextScan: status.nextScanTime,
      stats: {
        totalScans: status.scanCount,
        opportunitiesFound: status.opportunitiesFound,
      },
    };
  },
});

export const schedulerTools = [
  startSchedulerTool,
  stopSchedulerTool,
  getSchedulerStatusTool,
];
