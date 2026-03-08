/**
 * Structured Logger
 * Provides consistent logging across Gordon
 */

import { isGordonError, type GordonError } from "../../errors/index.ts";

/**
 * Log levels
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Log entry structure
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    code?: string;
    stack?: string;
  };
}

/**
 * Log transport interface
 */
export interface LogTransport {
  log(entry: LogEntry): void;
}

/**
 * Console transport - outputs to console with colors
 */
export class ConsoleTransport implements LogTransport {
  private colors = {
    debug: "\x1b[36m", // cyan
    info: "\x1b[32m",  // green
    warn: "\x1b[33m",  // yellow
    error: "\x1b[31m", // red
    reset: "\x1b[0m",
  };

  log(entry: LogEntry): void {
    const color = this.colors[entry.level];
    const reset = this.colors.reset;
    const levelStr = entry.level.toUpperCase().padEnd(5);
    const time = entry.timestamp.split("T")[1]?.split(".")[0] || entry.timestamp;

    let output = `${color}[${time}] ${levelStr}${reset} ${entry.message}`;

    if (entry.context && Object.keys(entry.context).length > 0) {
      output += ` ${JSON.stringify(entry.context)}`;
    }

    if (entry.error) {
      output += `\n  Error: ${entry.error.name}: ${entry.error.message}`;
      if (entry.error.code) {
        output += ` (${entry.error.code})`;
      }
    }

    switch (entry.level) {
      case "debug":
        console.debug(output);
        break;
      case "info":
        console.info(output);
        break;
      case "warn":
        console.warn(output);
        break;
      case "error":
        console.error(output);
        break;
    }
  }
}

/**
 * Memory transport - stores logs in memory (useful for testing)
 */
export class MemoryTransport implements LogTransport {
  public entries: LogEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries: number = 1000) {
    this.maxEntries = maxEntries;
  }

  log(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  clear(): void {
    this.entries = [];
  }

  getByLevel(level: LogLevel): LogEntry[] {
    return this.entries.filter((e) => e.level === level);
  }
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  level: LogLevel;
  transports: LogTransport[];
  context?: Record<string, unknown>;
}

/**
 * Log level priority (lower = more verbose)
 */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function isStartupQuietInfoSuppressed(level: LogLevel): boolean {
  return (
    level === "info" &&
    process.env.GORDON_STARTUP_QUIET === "1"
  );
}

/**
 * Main Logger class
 */
export class Logger {
  private config: LoggerConfig;
  private defaultContext: Record<string, unknown>;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: config.level || (process.env.LOG_LEVEL as LogLevel) || "error",
      transports: config.transports || [new ConsoleTransport()],
      context: config.context,
    };
    this.defaultContext = config.context || {};
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    if (isStartupQuietInfoSuppressed(level)) {
      return false;
    }
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.config.level];
  }

  /**
   * Create a log entry
   */
  private createEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error | GordonError
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    const mergedContext = { ...this.defaultContext, ...context };
    if (Object.keys(mergedContext).length > 0) {
      entry.context = mergedContext;
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
      if (isGordonError(error)) {
        entry.error.code = error.code;
      }
    }

    return entry;
  }

  /**
   * Write log entry to all transports
   */
  private write(entry: LogEntry): void {
    for (const transport of this.config.transports) {
      transport.log(entry);
    }
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog("debug")) {
      this.write(this.createEntry("debug", message, context));
    }
  }

  /**
   * Log an info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog("info")) {
      this.write(this.createEntry("info", message, context));
    }
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog("warn")) {
      this.write(this.createEntry("warn", message, context));
    }
  }

  /**
   * Log an error message
   * @param message - The log message
   * @param errorOrContext - Either an Error object or a context object
   * @param context - Additional context (only if second arg is Error)
   */
  error(
    message: string,
    errorOrContext?: Error | GordonError | Record<string, unknown>,
    context?: Record<string, unknown>
  ): void {
    if (this.shouldLog("error")) {
      // Check if second arg is an Error instance or a plain context object
      if (errorOrContext instanceof Error) {
        this.write(this.createEntry("error", message, context, errorOrContext));
      } else {
        // It's a context object
        this.write(this.createEntry("error", message, errorOrContext));
      }
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, unknown>): Logger {
    return new Logger({
      ...this.config,
      context: { ...this.defaultContext, ...context },
    });
  }

  /**
   * Set the minimum log level
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * Add a transport
   */
  addTransport(transport: LogTransport): void {
    this.config.transports.push(transport);
  }
}

// Default logger instance
let defaultLogger: Logger | null = null;

/**
 * Get the default logger instance
 */
export function getLogger(): Logger {
  if (!defaultLogger) {
    defaultLogger = new Logger({
      level: process.env.LOG_LEVEL as LogLevel || "error",
    });
  }
  return defaultLogger;
}

/**
 * Set the default logger instance
 */
export function setLogger(logger: Logger): void {
  defaultLogger = logger;
}

/**
 * Create a child logger with module context
 */
export function createModuleLogger(module: string): Logger {
  return getLogger().child({ module });
}
