/**
 * Broker Data Source
 *
 * Exposes normalized broker historical bars through the shared data-source layer.
 */

import type { BrokerAdapter } from "../../broker/types.ts";
import type { DataSource, DataSourceCapabilities, OHLCParams } from "./types.ts";
import type { Candle } from "../../../types/index.ts";

const DEFAULT_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "1d"];

export class BrokerDataSource implements DataSource {
  readonly id: string;
  readonly name: string;
  readonly priority: number;
  readonly requiresAuth = true;

  private readonly broker: BrokerAdapter;
  private readonly capabilities: DataSourceCapabilities;

  constructor(
    broker: BrokerAdapter,
    options: {
      priority?: number;
      supportedTimeframes?: string[];
      maxHistoricalDays?: number;
    } = {},
  ) {
    this.broker = broker;
    this.id = `broker-${broker.brokerId}`;
    this.name = `${broker.displayName} Broker`;
    this.priority = options.priority ?? 15;
    this.capabilities = {
      supportedTimeframes: options.supportedTimeframes ?? DEFAULT_TIMEFRAMES,
      maxHistoricalDays: options.maxHistoricalDays ?? 3650,
      realtime: false,
      exchanges: [broker.brokerId],
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.broker.capabilities.supportsHistoricalBars) {
      return false;
    }

    try {
      return await this.broker.testConnection();
    } catch {
      return false;
    }
  }

  getCapabilities(): DataSourceCapabilities {
    return this.capabilities;
  }

  async fetchOHLC(params: OHLCParams): Promise<Candle[]> {
    if (!this.broker.capabilities.supportsHistoricalBars) {
      throw new Error(`${this.broker.displayName} does not support historical bars.`);
    }

    return this.broker.getHistoricalBars({
      symbol: params.symbol,
      timeframe: params.timeframe,
      startTime: params.startTime,
      endTime: params.endTime,
    });
  }
}
