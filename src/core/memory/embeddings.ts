/**
 * Embedding Providers for Persistent Memory
 *
 * Provides two embedding backends:
 * 1. OpenAI text-embedding-3-small (1536d) — high quality, requires API key
 * 2. LocalEmbeddingProvider (256d) — TF-IDF bag-of-words, zero dependencies
 *
 * The factory function selects the best available provider automatically.
 */

import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("embeddings");

// ============================================================================
// Interface
// ============================================================================

export interface EmbeddingProvider {
  /** Generate an embedding vector for a single text */
  embed(text: string): Promise<number[]>;
  /** Generate embedding vectors for multiple texts in one call */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** Dimensionality of the embedding vectors */
  dimensions: number;
  /** Human-readable name of the provider */
  name: string;
}

// ============================================================================
// OpenAI Embedding Provider
// ============================================================================

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1536;
  readonly name = "openai";

  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(options?: { apiKey?: string; baseUrl?: string; model?: string }) {
    const nativeApiKey = process.env.GORDON_NATIVE_OPENAI_API_KEY;
    const nativeBaseUrl = process.env.GORDON_NATIVE_OPENAI_BASE_URL;
    const currentBaseUrl = process.env.OPENAI_BASE_URL;
    const looksLikeNativeOpenAI =
      !currentBaseUrl || currentBaseUrl === "https://api.openai.com/v1";

    this.apiKey =
      options?.apiKey ??
      nativeApiKey ??
      (looksLikeNativeOpenAI ? process.env.OPENAI_API_KEY : undefined) ??
      "";
    this.baseUrl =
      options?.baseUrl ??
      nativeBaseUrl ??
      (looksLikeNativeOpenAI ? process.env.OPENAI_BASE_URL : undefined) ??
      "https://api.openai.com/v1";
    this.model = options?.model ?? "text-embedding-3-small";

    if (!this.apiKey) {
      throw new Error(
        "OpenAIEmbeddingProvider requires OPENAI_API_KEY or an explicit apiKey"
      );
    }
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Truncate long texts to avoid token limits (approx 8191 tokens for embedding-3-small)
    const truncated = texts.map((t) => t.slice(0, 8000));

    const url = `${this.baseUrl.replace(/\/+$/, "")}/embeddings`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: truncated,
        model: this.model,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `OpenAI embeddings API error ${response.status}: ${body}`
      );
    }

    const json = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain input order
    const sorted = json.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}

// ============================================================================
// Local TF-IDF Embedding Provider (No External Dependencies)
// ============================================================================

/**
 * A simple bag-of-words / TF-IDF embedding provider that runs entirely locally.
 *
 * Strategy:
 * - Maintains a vocabulary built from all embedded texts
 * - Uses TF-IDF-like weighting with a fixed-size hash-based projection
 * - Dimension is 256 (configurable) via feature hashing (hashing trick)
 *
 * This provides meaningful similarity for keyword-overlapping texts without
 * any external API calls. Quality is lower than neural embeddings but
 * sufficient for hybrid search where BM25 handles keyword matching.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  readonly name = "local-tfidf";

  /** Document frequency: number of documents containing each token */
  private df: Map<string, number> = new Map();
  /** Total number of documents processed */
  private docCount = 0;

  constructor(dimensions: number = 256) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Update document frequency statistics
    for (const text of texts) {
      const tokens = this.tokenize(text);
      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        this.df.set(token, (this.df.get(token) ?? 0) + 1);
      }
      this.docCount++;
    }

    return texts.map((text) => this.computeVector(text));
  }

  /** Compute TF-IDF feature-hashed vector for a single text */
  private computeVector(text: string): number[] {
    const tokens = this.tokenize(text);
    const vector = new Float64Array(this.dimensions);

    if (tokens.length === 0) return Array.from(vector);

    // Term frequency (normalized by document length)
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    // Compute TF-IDF and project via feature hashing
    for (const [token, count] of tf.entries()) {
      const termFreq = count / tokens.length;
      const docFreq = this.df.get(token) ?? 1;
      // Smooth IDF to avoid division by zero and reduce impact of very rare terms
      const idf = Math.log((this.docCount + 1) / (docFreq + 1)) + 1;
      const weight = termFreq * idf;

      // Feature hashing: map token to a bucket index
      const hash = this.hashToken(token);
      const bucketIndex = Math.abs(hash) % this.dimensions;
      // Use sign of hash for sign of the projection (reduces collision bias)
      const sign = hash >= 0 ? 1 : -1;
      vector[bucketIndex] = vector[bucketIndex]! + sign * weight;
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += vector[i]! * vector[i]!;
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] = vector[i]! / norm;
      }
    }

    return Array.from(vector);
  }

  /** Simple tokenizer: lowercase, split on non-alphanumeric, filter short tokens */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s.%-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  /**
   * Simple string hash function (djb2 variant).
   * Returns a signed integer for feature hashing.
   */
  private hashToken(token: string): number {
    let hash = 5381;
    for (let i = 0; i < token.length; i++) {
      // hash * 33 + char
      hash = ((hash << 5) + hash + token.charCodeAt(i)) | 0;
    }
    return hash;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create the best available embedding provider.
 *
 * Returns OpenAIEmbeddingProvider if OPENAI_API_KEY is set,
 * otherwise falls back to LocalEmbeddingProvider (no API needed).
 */
export function createEmbeddingProvider(): EmbeddingProvider {
  const nativeApiKey = process.env.GORDON_NATIVE_OPENAI_API_KEY;
  const currentBaseUrl = process.env.OPENAI_BASE_URL;
  const looksLikeNativeOpenAI =
    !currentBaseUrl || currentBaseUrl === "https://api.openai.com/v1";
  const apiKey = nativeApiKey ?? (looksLikeNativeOpenAI ? process.env.OPENAI_API_KEY : undefined);

  if (apiKey) {
    try {
      const provider = new OpenAIEmbeddingProvider({
        apiKey,
        baseUrl:
          process.env.GORDON_NATIVE_OPENAI_BASE_URL ??
          (looksLikeNativeOpenAI ? process.env.OPENAI_BASE_URL : undefined),
      });
      logger.info("Using OpenAI embedding provider", {
        model: "text-embedding-3-small",
        dimensions: String(provider.dimensions),
      });
      return provider;
    } catch (err) {
      logger.warn("Failed to create OpenAI embedding provider, falling back to local", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const provider = new LocalEmbeddingProvider();
  logger.info("Using local TF-IDF embedding provider", {
    dimensions: String(provider.dimensions),
  });
  return provider;
}
