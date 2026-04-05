// ============================================================================
// News RAG — Retrieval-augmented context for current news analysis
//
// Stores recent news, retrieves 3 most relevant articles when analyzing
// new news. Uses TF-IDF + Jaccard similarity (no external embedding API).
// ============================================================================

export interface NewsArticle {
  id: string;
  ticker: string;
  title: string;
  content: string;
  date: string;
  timestamp: number;
  keywords: Set<string>;
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "and", "or", "but",
  "in", "on", "at", "to", "of", "for", "with", "by", "from", "as",
  "that", "this", "these", "those", "it", "its", "be", "been", "being",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

export class NewsRAG {
  private articles: NewsArticle[] = [];
  private maxArticles: number;

  constructor(maxArticles: number = 500) {
    this.maxArticles = maxArticles;
  }

  add(ticker: string, title: string, content: string, date: string): void {
    const id = `news_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.articles.push({
      id, ticker: ticker.toUpperCase(), title, content, date,
      timestamp: Date.now(),
      keywords: tokenize(`${title} ${content}`),
    });

    if (this.articles.length > this.maxArticles) {
      this.articles.sort((a, b) => b.timestamp - a.timestamp);
      this.articles = this.articles.slice(0, this.maxArticles);
    }
  }

  retrieve(query: string, options: { ticker?: string; k?: number; maxAge?: number } = {}): NewsArticle[] {
    const { ticker, k = 3, maxAge } = options;
    const queryKeywords = tokenize(query);
    const now = Date.now();

    const candidates = this.articles.filter((a) => {
      if (ticker && a.ticker !== ticker.toUpperCase()) return false;
      if (maxAge && now - a.timestamp > maxAge) return false;
      return true;
    });

    const scored = candidates.map((a) => ({
      article: a,
      score: jaccardSimilarity(queryKeywords, a.keywords),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score > 0.05).slice(0, k).map((s) => s.article);
  }

  buildContext(query: string, options?: { ticker?: string; k?: number }): string {
    const articles = this.retrieve(query, options);
    if (articles.length === 0) return "";

    return articles
      .map((a, i) => `[Context ${i + 1}] (${a.date} ${a.ticker}) ${a.title}\n${a.content.slice(0, 200)}`)
      .join("\n\n");
  }

  size(): number { return this.articles.length; }
  clear(): void { this.articles = []; }
}

let instance: NewsRAG | null = null;
export function getNewsRAG(): NewsRAG {
  if (!instance) instance = new NewsRAG();
  return instance;
}
