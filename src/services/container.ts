/**
 * Service Container
 * Dependency injection container for Gordon services
 */

import { BinanceClient } from "../infra/binance/index.ts";
import { LLMClient } from "../infra/llm/index.ts";
import { PriceCache } from "../infra/cache/index.ts";
import { EventBus } from "../events/index.ts";
import { Logger, ConsoleTransport, type LogLevel } from "../infra/logger/index.ts";
import { PlansRepository, TradesRepository } from "../repositories/index.ts";
import { initDatabase } from "../infra/storage/database.ts";
import type { GordonConfig } from "../types/index.ts";

/**
 * Service container configuration
 */
export interface ContainerConfig {
  binance?: {
    apiKey: string;
    apiSecret: string;
  };
  openai?: {
    apiKey: string;
    model?: string;
  };
  logLevel?: LogLevel;
  config?: GordonConfig;
}

/**
 * All services available in the container
 */
export interface Services {
  // Infrastructure
  logger: Logger;
  eventBus: EventBus;
  priceCache: PriceCache;

  // External APIs
  binance: BinanceClient | null;
  llm: LLMClient | null;

  // Repositories
  plansRepo: PlansRepository;
  tradesRepo: TradesRepository;

  // Config
  config: GordonConfig | null;
}

/**
 * Service container - manages all service instances
 */
export class ServiceContainer {
  private services: Partial<Services> = {};
  private initialized = false;

  /**
   * Initialize the container with configuration
   */
  async initialize(config: ContainerConfig): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Initialize database first
    initDatabase();

    // Create logger
    this.services.logger = new Logger({
      level: config.logLevel || "info",
      transports: [new ConsoleTransport()],
    });

    // Create event bus
    this.services.eventBus = new EventBus();

    // Create price cache
    this.services.priceCache = new PriceCache();

    // Create Binance client if credentials provided
    if (config.binance?.apiKey && config.binance?.apiSecret) {
      this.services.binance = new BinanceClient(
        config.binance.apiKey,
        config.binance.apiSecret
      );
      this.services.logger.info("Binance client initialized");
    } else {
      this.services.binance = null;
      this.services.logger.warn("Binance client not initialized - no credentials");
    }

    // Create LLM client if API key provided
    if (config.openai?.apiKey) {
      this.services.llm = new LLMClient({
        openaiApiKey: config.openai.apiKey,
        defaultModel: config.openai.model,
      });
      this.services.logger.info("LLM client initialized");
    } else {
      this.services.llm = null;
      this.services.logger.warn("LLM client not initialized - no API key");
    }

    // Create repositories
    this.services.plansRepo = new PlansRepository();
    this.services.tradesRepo = new TradesRepository();

    // Store config
    this.services.config = config.config || null;

    this.initialized = true;
    this.services.logger.info("Service container initialized");
  }

  /**
   * Get a service by name
   */
  get<K extends keyof Services>(name: K): Services[K] {
    if (!this.initialized) {
      throw new Error("Service container not initialized. Call initialize() first.");
    }

    const service = this.services[name];
    if (service === undefined) {
      throw new Error(`Service not found: ${name}`);
    }

    return service as Services[K];
  }

  /**
   * Check if a service is available
   */
  has<K extends keyof Services>(name: K): boolean {
    return this.services[name] !== undefined && this.services[name] !== null;
  }

  /**
   * Register a custom service
   */
  register<K extends keyof Services>(name: K, service: Services[K]): void {
    this.services[name] = service;
  }

  /**
   * Get the logger
   */
  get logger(): Logger {
    return this.get("logger");
  }

  /**
   * Get the event bus
   */
  get eventBus(): EventBus {
    return this.get("eventBus");
  }

  /**
   * Get the Binance client
   */
  get binance(): BinanceClient | null {
    return this.get("binance");
  }

  /**
   * Get the LLM client
   */
  get llm(): LLMClient | null {
    return this.get("llm");
  }

  /**
   * Get the price cache
   */
  get priceCache(): PriceCache {
    return this.get("priceCache");
  }

  /**
   * Get the plans repository
   */
  get plansRepo(): PlansRepository {
    return this.get("plansRepo");
  }

  /**
   * Get the trades repository
   */
  get tradesRepo(): TradesRepository {
    return this.get("tradesRepo");
  }

  /**
   * Check if container is initialized
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Reset the container (useful for testing)
   */
  reset(): void {
    this.services = {};
    this.initialized = false;
  }
}

// Default container instance
let defaultContainer: ServiceContainer | null = null;

/**
 * Get the default service container
 */
export function getContainer(): ServiceContainer {
  if (!defaultContainer) {
    defaultContainer = new ServiceContainer();
  }
  return defaultContainer;
}

/**
 * Set the default service container
 */
export function setContainer(container: ServiceContainer): void {
  defaultContainer = container;
}

/**
 * Initialize the default container
 */
export async function initializeContainer(config: ContainerConfig): Promise<ServiceContainer> {
  const container = getContainer();
  await container.initialize(config);
  return container;
}
