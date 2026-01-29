/**
 * Scheduler Tools (Mastra Format)
 * Tools for controlling background market scanning
 *
 * Migrated from OpenAI Agents SDK format to Mastra format.
 * Key differences:
 * - tool() -> createTool()
 * - name -> id
 * - parameters -> inputSchema
 * - Context access via first parameter destructuring
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
} from "../../../core/scheduler.ts";
import { getGordonContext, MastraExecutionContext } from "./types.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noBinance: { error: "Binance client not connected. Please run setup first." },
};

// ============================================================================
// Start Scheduler Tool
// ============================================================================

export const startSchedulerTool = createTool({
  id: "start_background_scanning",
  description:
    "Start automatic background market scanning at regular intervals. " +
    "Use when the user says 'keep scanning', 'monitor the market', or 'alert me when there's an opportunity'.",
  inputSchema: z.object({
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
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    status: z.object({
      isRunning: z.boolean(),
      intervalMs: z.number().optional(),
      lastScanTime: z.string().nullable().optional(),
      nextScanTime: z.string().nullable().optional(),
      scanCount: z.number().optional(),
      opportunitiesFound: z.number().optional(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ intervalMinutes, topN, minConfidence }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
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

export const stopSchedulerTool = createTool({
  id: "stop_background_scanning",
  description:
    "Stop automatic background market scanning. " +
    "Use when the user says 'stop scanning', 'stop monitoring', or 'cancel alerts'.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    finalStats: z.object({
      scanCount: z.number(),
      opportunitiesFound: z.number(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
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

export const getSchedulerStatusTool = createTool({
  id: "get_scanning_status",
  description:
    "Check the status of background market scanning. " +
    "Use when the user asks 'is scanning running?', 'when is the next scan?', or 'scanning status'.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    isRunning: z.boolean(),
    message: z.string(),
    lastScan: z.string().nullable().optional(),
    nextScan: z.string().nullable().optional(),
    stats: z.object({
      totalScans: z.number(),
      opportunitiesFound: z.number(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
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

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Scheduler tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 */
export const schedulerTools = {
  start_background_scanning: startSchedulerTool,
  stop_background_scanning: stopSchedulerTool,
  get_scanning_status: getSchedulerStatusTool,
};
