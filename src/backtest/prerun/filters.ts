/**
 * Backtest Data Filtering Utilities
 */

import type { OHLC } from "../types.ts";

function parseTimeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(":").map((part) => Number(part));
  return (hours || 0) * 60 + (minutes || 0);
}

function getUtcMinutes(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function isWeekday(timestamp: number): boolean {
  const day = new Date(timestamp).getUTCDay();
  return day >= 1 && day <= 5;
}

export function filterExcludeMonths(
  ohlcData: OHLC[],
  startMonth: number = 5,
  endMonth: number = 9
): {
  status: "success" | "error";
  filteredData?: OHLC[];
  originalRows?: number;
  filteredRows?: number;
  rowsRemoved?: number;
  error?: string;
} {
  try {
    const filtered = ohlcData.filter((bar) => {
      const month = new Date(bar.timestamp).getUTCMonth() + 1;
      return !(month >= startMonth && month <= endMonth);
    });

    return {
      status: "success",
      filteredData: filtered,
      originalRows: ohlcData.length,
      filteredRows: filtered.length,
      rowsRemoved: ohlcData.length - filtered.length,
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export function filterMarketHours(
  ohlcData: OHLC[],
  openTimeStr: string = "13:30",
  closeTimeStr: string = "20:00"
): {
  status: "success" | "error";
  marketHoursData?: OHLC[];
  nonMarketHoursData?: OHLC[];
  marketHoursRows?: number;
  nonMarketHoursRows?: number;
  error?: string;
} {
  try {
    const openMinutes = parseTimeToMinutes(openTimeStr);
    const closeMinutes = parseTimeToMinutes(closeTimeStr);

    const weekdayData = ohlcData.filter((bar) => isWeekday(bar.timestamp));

    const marketHours = weekdayData.filter((bar) => {
      const minutes = getUtcMinutes(bar.timestamp);
      return minutes >= openMinutes && minutes < closeMinutes;
    });

    const nonMarketHours = weekdayData.filter((bar) => {
      const minutes = getUtcMinutes(bar.timestamp);
      return minutes < openMinutes || minutes >= closeMinutes;
    });

    return {
      status: "success",
      marketHoursData: marketHours,
      nonMarketHoursData: nonMarketHours,
      marketHoursRows: marketHours.length,
      nonMarketHoursRows: nonMarketHours.length,
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export function filterFirstLastHour(
  ohlcData: OHLC[],
  marketOpenStr: string = "13:30",
  oneHourAfterOpenStr: string = "14:30",
  oneHourBeforeCloseStr: string = "19:00",
  marketCloseStr: string = "20:00"
): {
  status: "success" | "error";
  filteredData?: OHLC[];
  originalRows?: number;
  filteredRows?: number;
  rowsRemoved?: number;
  error?: string;
} {
  try {
    const openMinutes = parseTimeToMinutes(marketOpenStr);
    const afterOpenMinutes = parseTimeToMinutes(oneHourAfterOpenStr);
    const beforeCloseMinutes = parseTimeToMinutes(oneHourBeforeCloseStr);
    const closeMinutes = parseTimeToMinutes(marketCloseStr);

    const filtered = ohlcData.filter((bar) => {
      if (!isWeekday(bar.timestamp)) {
        return false;
      }
      const minutes = getUtcMinutes(bar.timestamp);
      const inOpenWindow = minutes >= openMinutes && minutes <= afterOpenMinutes;
      const inCloseWindow = minutes >= beforeCloseMinutes && minutes <= closeMinutes;
      return inOpenWindow || inCloseWindow;
    });

    return {
      status: "success",
      filteredData: filtered,
      originalRows: ohlcData.length,
      filteredRows: filtered.length,
      rowsRemoved: ohlcData.length - filtered.length,
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
