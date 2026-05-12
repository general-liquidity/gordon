/**
 * Stream Writer Abstraction for Gordon
 *
 * Provides a unified interface for piping workflow results to various destinations
 * using Mastra's pipeTo(writer) pattern. Supports real-time progress reporting
 * during parallel execution.
 *
 * Key Features:
 * - StreamWriter interface for custom destinations (file, WebSocket, etc.)
 * - StreamChunk types for progress, results, and errors
 * - Built-in writers for common use cases
 * - Support for backpressure handling
 */

import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("stream-writer");

// ============================================================================
// Types
// ============================================================================

/**
 * Type of stream chunk being written
 */
export type StreamChunkType = "progress" | "result" | "error" | "start" | "end" | "heartbeat";

/**
 * A chunk of data written to the stream
 */
export interface StreamChunk<T = unknown> {
  /** Type of chunk */
  type: StreamChunkType;
  /** The actual data payload */
  data: T;
  /** Timestamp when chunk was created */
  timestamp: number;
  /** Optional metadata */
  metadata?: {
    /** Source operation or agent */
    source?: string;
    /** Sequence number for ordering */
    sequence?: number;
    /** Total expected chunks (if known) */
    totalExpected?: number;
    /** Current progress percentage (0-100) */
    progressPercent?: number;
    /** Additional context */
    context?: Record<string, unknown>;
  };
}

/**
 * Stream writer interface - implement this to create custom destinations
 */
export interface StreamWriter<T = unknown> {
  /**
   * Write a chunk to the stream
   * @param chunk - The chunk to write
   * @returns Promise that resolves when write completes
   */
  write(chunk: StreamChunk<T>): Promise<void>;

  /**
   * Close the stream and release resources
   * @returns Promise that resolves when close completes
   */
  close(): Promise<void>;

  /**
   * Check if the writer is ready to accept more data
   * Used for backpressure handling
   */
  isReady?(): boolean;

  /**
   * Abort the stream with an error
   * @param reason - The reason for aborting
   */
  abort?(reason: Error): Promise<void>;
}

/**
 * Options for creating a streaming workflow
 */
export interface StreamingWorkflowOptions {
  /** Enable heartbeat chunks during long operations */
  enableHeartbeat?: boolean;
  /** Heartbeat interval in ms (default: 5000) */
  heartbeatInterval?: number;
  /** Buffer size before applying backpressure */
  bufferSize?: number;
  /** Timeout for individual operations in ms */
  operationTimeout?: number;
  /** Custom metadata to include with each chunk */
  metadata?: Record<string, unknown>;
}

/**
 * Progress data for streaming operations
 */
export interface ProgressData {
  /** Current step or operation name */
  step: string;
  /** Current item being processed */
  current: number;
  /** Total items to process */
  total: number;
  /** Percentage complete */
  percent: number;
  /** Estimated time remaining in ms */
  estimatedTimeRemaining?: number;
  /** Current operation status */
  status: "pending" | "running" | "completed" | "failed";
}

/**
 * Result data for streaming operations
 */
export interface ResultData<T = unknown> {
  /** Operation identifier */
  operationId: string;
  /** Whether the operation succeeded */
  success: boolean;
  /** The result data if successful */
  data?: T;
  /** Error message if failed */
  error?: string;
  /** Duration of the operation in ms */
  duration: number;
}

/**
 * Analysis result chunk for streaming analysis
 */
export interface AnalysisChunk {
  symbol: string;
  success: boolean;
  analysis?: {
    bias?: string;
    setupConfidence?: number;
    price?: number;
    trend?: string;
    [key: string]: unknown;
  };
  error?: string;
  duration: number;
}

// ============================================================================
// Stream Chunk Factory
// ============================================================================

let sequenceCounter = 0;

/**
 * Create a stream chunk with automatic timestamp and sequence
 */
export function createChunk<T>(
  type: StreamChunkType,
  data: T,
  metadata?: StreamChunk<T>["metadata"]
): StreamChunk<T> {
  return {
    type,
    data,
    timestamp: Date.now(),
    metadata: {
      sequence: ++sequenceCounter,
      ...metadata,
    },
  };
}

/**
 * Create a progress chunk
 */
export function createProgressChunk(progress: ProgressData, source?: string): StreamChunk<ProgressData> {
  return createChunk("progress", progress, {
    source,
    progressPercent: progress.percent,
  });
}

/**
 * Create a result chunk
 */
export function createResultChunk<T>(result: ResultData<T>, source?: string): StreamChunk<ResultData<T>> {
  return createChunk("result", result, { source });
}

/**
 * Create an error chunk
 */
export function createErrorChunk(error: Error | string, source?: string): StreamChunk<{ message: string; name?: string; stack?: string }> {
  const errorData = error instanceof Error
    ? { message: error.message, name: error.name, stack: error.stack }
    : { message: error };

  return createChunk("error", errorData, { source });
}

/**
 * Create a start chunk
 */
export function createStartChunk(operationName: string, totalExpected?: number): StreamChunk<{ operation: string }> {
  return createChunk("start", { operation: operationName }, {
    source: operationName,
    totalExpected,
  });
}

/**
 * Create an end chunk
 */
export function createEndChunk(operationName: string, summary?: Record<string, unknown>): StreamChunk<{ operation: string; summary?: Record<string, unknown> }> {
  return createChunk("end", { operation: operationName, summary }, {
    source: operationName,
    progressPercent: 100,
  });
}

/**
 * Create a heartbeat chunk
 */
export function createHeartbeatChunk(source?: string): StreamChunk<{ alive: true }> {
  return createChunk("heartbeat", { alive: true }, { source });
}

// ============================================================================
// Built-in Stream Writers
// ============================================================================

/**
 * Console writer - writes chunks to console for debugging
 */
export class ConsoleStreamWriter implements StreamWriter {
  private closed = false;
  private prefix: string;

  constructor(prefix = "[Stream]") {
    this.prefix = prefix;
  }

  async write(chunk: StreamChunk): Promise<void> {
    if (this.closed) {
      throw new Error("Writer is closed");
    }

    const timestamp = new Date(chunk.timestamp).toISOString();
    const prefix = this.prefix;
    const source = chunk.metadata?.source || "unknown";

    switch (chunk.type) {
      case "progress":
        const progress = chunk.data as ProgressData;
        console.log(`${prefix} [${timestamp}] Progress (${source}): ${progress.step} - ${progress.current}/${progress.total} (${progress.percent}%)`);
        break;
      case "result":
        const result = chunk.data as ResultData;
        console.log(`${prefix} [${timestamp}] Result (${source}): ${result.success ? "SUCCESS" : "FAILED"} - ${result.operationId} (${result.duration}ms)`);
        break;
      case "error":
        const error = chunk.data as { message: string };
        console.error(`${prefix} [${timestamp}] Error (${source}): ${error.message}`);
        break;
      case "start":
        console.log(`${prefix} [${timestamp}] Started: ${source}`);
        break;
      case "end":
        console.log(`${prefix} [${timestamp}] Completed: ${source}`);
        break;
      case "heartbeat":
        console.log(`${prefix} [${timestamp}] Heartbeat (${source})`);
        break;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    console.log(`${this.prefix} Stream closed`);
  }

  isReady(): boolean {
    return !this.closed;
  }

  async abort(reason: Error): Promise<void> {
    this.closed = true;
    console.error(`${this.prefix} Stream aborted: ${reason.message}`);
  }
}

/**
 * Array writer - collects chunks into an array
 */
export class ArrayStreamWriter<T = unknown> implements StreamWriter<T> {
  private closed = false;
  private chunks: StreamChunk<T>[] = [];

  async write(chunk: StreamChunk<T>): Promise<void> {
    if (this.closed) {
      throw new Error("Writer is closed");
    }
    this.chunks.push(chunk);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  isReady(): boolean {
    return !this.closed;
  }

  async abort(reason: Error): Promise<void> {
    this.closed = true;
    this.chunks.push(createErrorChunk(reason) as StreamChunk<T>);
  }

  /**
   * Get all collected chunks
   */
  getChunks(): StreamChunk<T>[] {
    return [...this.chunks];
  }

  /**
   * Get only result chunks
   */
  getResults(): StreamChunk<T>[] {
    return this.chunks.filter(c => c.type === "result");
  }

  /**
   * Get only error chunks
   */
  getErrors(): StreamChunk<T>[] {
    return this.chunks.filter(c => c.type === "error");
  }

  /**
   * Clear collected chunks
   */
  clear(): void {
    this.chunks = [];
  }
}

/**
 * Callback writer - invokes a callback for each chunk
 */
export class CallbackStreamWriter<T = unknown> implements StreamWriter<T> {
  private closed = false;
  private callback: (chunk: StreamChunk<T>) => void | Promise<void>;
  private onClose?: () => void | Promise<void>;
  private onAbort?: (reason: Error) => void | Promise<void>;

  constructor(
    callback: (chunk: StreamChunk<T>) => void | Promise<void>,
    options?: {
      onClose?: () => void | Promise<void>;
      onAbort?: (reason: Error) => void | Promise<void>;
    }
  ) {
    this.callback = callback;
    this.onClose = options?.onClose;
    this.onAbort = options?.onAbort;
  }

  async write(chunk: StreamChunk<T>): Promise<void> {
    if (this.closed) {
      throw new Error("Writer is closed");
    }
    await this.callback(chunk);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.onClose) {
      await this.onClose();
    }
  }

  isReady(): boolean {
    return !this.closed;
  }

  async abort(reason: Error): Promise<void> {
    this.closed = true;
    if (this.onAbort) {
      await this.onAbort(reason);
    }
  }
}

/**
 * Multiplexer writer - writes to multiple destinations
 */
export class MultiplexStreamWriter<T = unknown> implements StreamWriter<T> {
  private closed = false;
  private writers: StreamWriter<T>[];

  constructor(writers: StreamWriter<T>[]) {
    this.writers = writers;
  }

  async write(chunk: StreamChunk<T>): Promise<void> {
    if (this.closed) {
      throw new Error("Writer is closed");
    }
    await Promise.all(this.writers.map(w => w.write(chunk)));
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.writers.map(w => w.close()));
  }

  isReady(): boolean {
    return !this.closed && this.writers.every(w => !w.isReady || w.isReady());
  }

  async abort(reason: Error): Promise<void> {
    this.closed = true;
    await Promise.all(this.writers.map(w => w.abort?.(reason)));
  }
}

/**
 * Transform writer - transforms chunks before writing to another writer
 */
export class TransformStreamWriter<TIn = unknown, TOut = unknown> implements StreamWriter<TIn> {
  private closed = false;
  private target: StreamWriter<TOut>;
  private transform: (chunk: StreamChunk<TIn>) => StreamChunk<TOut> | null | Promise<StreamChunk<TOut> | null>;

  constructor(
    target: StreamWriter<TOut>,
    transform: (chunk: StreamChunk<TIn>) => StreamChunk<TOut> | null | Promise<StreamChunk<TOut> | null>
  ) {
    this.target = target;
    this.transform = transform;
  }

  async write(chunk: StreamChunk<TIn>): Promise<void> {
    if (this.closed) {
      throw new Error("Writer is closed");
    }
    const transformed = await this.transform(chunk);
    if (transformed !== null) {
      await this.target.write(transformed);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.target.close();
  }

  isReady(): boolean {
    return !this.closed && (!this.target.isReady || this.target.isReady());
  }

  async abort(reason: Error): Promise<void> {
    this.closed = true;
    await this.target.abort?.(reason);
  }
}

// ============================================================================
// Streaming Pipeline Helper
// ============================================================================

/**
 * Result of a streaming operation
 */
export interface StreamingResult<T> {
  /** Total chunks written */
  chunksWritten: number;
  /** Total errors encountered */
  errors: number;
  /** Duration in ms */
  duration: number;
  /** Final summary data */
  summary?: T;
}

/**
 * Create a streaming pipeline that can pipe to a writer
 * This implements the Mastra pipeTo pattern
 */
export function createStreamingPipeline<T>(
  source: AsyncIterable<T>,
  options?: StreamingWorkflowOptions
): {
  pipeTo: (writer: StreamWriter<T>) => Promise<StreamingResult<T>>;
  [Symbol.asyncIterator]: () => AsyncIterator<T>;
} {
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  return {
    async pipeTo(writer: StreamWriter<T>): Promise<StreamingResult<T>> {
      const startTime = Date.now();
      let chunksWritten = 0;
      let errors = 0;
      let lastItem: T | undefined;

      try {
        // Start heartbeat if enabled
        if (options?.enableHeartbeat) {
          const interval = options.heartbeatInterval || 5000;
          heartbeatInterval = setInterval(async () => {
            try {
              await writer.write(createHeartbeatChunk(options.metadata?.source as string) as StreamChunk<T>);
            } catch (e) {
              // Ignore heartbeat errors
            }
          }, interval);
        }

        // Write start chunk
        await writer.write(createStartChunk("pipeline") as StreamChunk<T>);
        chunksWritten++;

        // Process source items
        for await (const item of source) {
          // Check backpressure
          if (writer.isReady && !writer.isReady()) {
            logger.warn("Writer not ready, waiting...");
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          const chunk = createChunk("result", item, options?.metadata);
          await writer.write(chunk);
          chunksWritten++;
          lastItem = item;
        }

        // Write end chunk
        await writer.write(createEndChunk("pipeline", { chunksWritten, errors }) as StreamChunk<T>);
        chunksWritten++;

      } catch (err) {
        errors++;
        const error = err instanceof Error ? err : new Error(String(err));
        await writer.write(createErrorChunk(error) as StreamChunk<T>);

        if (writer.abort) {
          await writer.abort(error);
        }
      } finally {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
        await writer.close();
      }

      return {
        chunksWritten,
        errors,
        duration: Date.now() - startTime,
        summary: lastItem,
      };
    },

    [Symbol.asyncIterator](): AsyncIterator<T> {
      return source[Symbol.asyncIterator]();
    },
  };
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a console writer for debugging
 */
export function createConsoleWriter(prefix?: string): ConsoleStreamWriter {
  return new ConsoleStreamWriter(prefix);
}

/**
 * Create an array writer for collecting results
 */
export function createArrayWriter<T = unknown>(): ArrayStreamWriter<T> {
  return new ArrayStreamWriter<T>();
}

/**
 * Create a callback writer
 */
export function createCallbackWriter<T = unknown>(
  callback: (chunk: StreamChunk<T>) => void | Promise<void>,
  options?: {
    onClose?: () => void | Promise<void>;
    onAbort?: (reason: Error) => void | Promise<void>;
  }
): CallbackStreamWriter<T> {
  return new CallbackStreamWriter<T>(callback, options);
}

/**
 * Create a multiplexer writer that writes to multiple destinations
 */
export function createMultiplexWriter<T = unknown>(writers: StreamWriter<T>[]): MultiplexStreamWriter<T> {
  return new MultiplexStreamWriter<T>(writers);
}

/**
 * Create a transform writer that transforms chunks
 */
export function createTransformWriter<TIn = unknown, TOut = unknown>(
  target: StreamWriter<TOut>,
  transform: (chunk: StreamChunk<TIn>) => StreamChunk<TOut> | null | Promise<StreamChunk<TOut> | null>
): TransformStreamWriter<TIn, TOut> {
  return new TransformStreamWriter<TIn, TOut>(target, transform);
}
