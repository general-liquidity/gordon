/**
 * Chat History Persistence
 * Saves and loads conversation sessions to ~/.gordon/history/
 */

import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { GORDON_DIR } from "../paths.ts";
const HISTORY_DIR = join(GORDON_DIR, "history");
const HISTORY_READ_CONCURRENCY = 6;

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      const item = items[currentIndex];
      if (item === undefined) {
        return;
      }

      results[currentIndex] = await mapper(item, currentIndex);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Message structure for chat history
 */
export interface ChatHistoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  /** Agent that handled this message (for assistant messages) */
  agent?: string;
  /** Tool calls made during this message */
  toolCalls?: string[];
}

/**
 * Complete chat session structure
 */
export interface ChatSession {
  /** Unique session ID (based on start timestamp) */
  id: string;
  /** Session start time */
  startedAt: string;
  /** Session end time (when saved) */
  endedAt: string;
  /** All messages in the conversation */
  messages: ChatHistoryMessage[];
  /** Symbols/coins discussed in this session */
  symbolsDiscussed: string[];
  /** Commands used in this session */
  commandsUsed: string[];
  /** Session metadata */
  metadata: {
    /** Gordon version */
    version: string;
    /** Permission mode during session */
    permissionMode: "auto" | "ask" | "strict";
    /** Total message count */
    messageCount: number;
    /** Session duration in seconds */
    durationSeconds: number;
    /** Mastra threadId for session resume */
    threadId?: string;
    /** Mastra resourceId for user identification */
    resourceId?: string;
  };
}

/**
 * Summary of a saved session for listing
 */
export interface ChatSessionSummary {
  id: string;
  filename: string;
  startedAt: string;
  endedAt: string;
  messageCount: number;
  symbolsDiscussed: string[];
  previewMessage?: string;
}

/**
 * Ensure the history directory exists
 */
async function ensureHistoryDir(): Promise<void> {
  await mkdir(HISTORY_DIR, { recursive: true });
}

/**
 * Generate a filename based on timestamp
 * Format: YYYY-MM-DD_HH-MM-SS.json
 */
function generateFilename(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}.json`;
}

/**
 * Parse a filename to extract the date
 */
function parseFilename(filename: string): Date | null {
  const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.json$/);
  if (!match) return null;

  const [, year, month, day, hours, minutes, seconds] = match;
  return new Date(
    parseInt(year!, 10),
    parseInt(month!, 10) - 1,
    parseInt(day!, 10),
    parseInt(hours!, 10),
    parseInt(minutes!, 10),
    parseInt(seconds!, 10)
  );
}

/**
 * Extract symbols discussed from messages
 * Looks for common crypto symbols in the text
 */
function extractSymbols(messages: ChatHistoryMessage[]): string[] {
  const symbolPattern = /\b([A-Z]{2,10})(USDT|BTC|ETH|BNB|BUSD)?\b/g;
  const commonCryptos = new Set([
    "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "DOT", "MATIC",
    "SHIB", "AVAX", "LINK", "LTC", "UNI", "ATOM", "XLM", "TRX", "ETC",
    "NEAR", "APT", "OP", "ARB", "INJ", "SUI", "SEI", "PEPE", "WIF",
  ]);

  const found = new Set<string>();

  for (const msg of messages) {
    const matches = msg.content.matchAll(symbolPattern);
    for (const match of matches) {
      const symbol = match[1];
      if (symbol && (commonCryptos.has(symbol) || match[2])) {
        found.add(symbol);
      }
    }
  }

  return Array.from(found);
}

/**
 * Extract commands used from messages
 */
function extractCommands(messages: ChatHistoryMessage[]): string[] {
  const commands = new Set<string>();

  for (const msg of messages) {
    if (msg.role === "user" && msg.content.startsWith("/")) {
      const command = msg.content.split(/\s+/)[0]?.toLowerCase();
      if (command) {
        commands.add(command);
      }
    }
  }

  return Array.from(commands);
}

/**
 * Save a chat session to disk
 */
export async function saveChatSession(
  messages: ChatHistoryMessage[],
  options: {
    startedAt?: Date;
    permissionMode?: "auto" | "ask" | "strict";
    version?: string;
    threadId?: string;
    resourceId?: string;
  } = {}
): Promise<{ filename: string; path: string }> {
  await ensureHistoryDir();

  const startDate = options.startedAt || new Date(messages[0]?.timestamp || Date.now());
  const endDate = new Date();
  const filename = generateFilename(startDate);
  const filepath = join(HISTORY_DIR, filename);

  const session: ChatSession = {
    id: filename.replace(".json", ""),
    startedAt: startDate.toISOString(),
    endedAt: endDate.toISOString(),
    messages,
    symbolsDiscussed: extractSymbols(messages),
    commandsUsed: extractCommands(messages),
    metadata: {
      version: options.version || "1.0.0",
      permissionMode: options.permissionMode || "ask",
      messageCount: messages.length,
      durationSeconds: Math.floor((endDate.getTime() - startDate.getTime()) / 1000),
      threadId: options.threadId,
      resourceId: options.resourceId,
    },
  };

  await Bun.write(filepath, JSON.stringify(session, null, 2));

  return { filename, path: filepath };
}

/**
 * Load a specific chat session
 */
export async function loadChatSession(filename: string): Promise<ChatSession | null> {
  const filepath = join(HISTORY_DIR, filename);

  try {
    const content = await readFile(filepath, "utf-8");
    const session = JSON.parse(content) as ChatSession;
    return session;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Load the most recent chat session
 */
export async function loadLatestSession(): Promise<ChatSession | null> {
  const sessions = await listChatSessions({ limit: 1 });
  if (sessions.length === 0) return null;

  return loadChatSession(sessions[0]!.filename);
}

/**
 * List all saved chat sessions
 */
export async function listChatSessions(options: {
  limit?: number;
  offset?: number;
  /** Filter by date range (inclusive) */
  fromDate?: Date;
  toDate?: Date;
  /** Filter by symbols discussed */
  symbols?: string[];
} = {}): Promise<ChatSessionSummary[]> {
  await ensureHistoryDir();

  let files: string[];
  try {
    files = await readdir(HISTORY_DIR);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  // Filter to only .json files and sort by date descending (newest first)
  const jsonFiles = files
    .filter(f => f.endsWith(".json"))
    .sort((a, b) => {
      const dateA = parseFilename(a);
      const dateB = parseFilename(b);
      if (!dateA || !dateB) return 0;
      return dateB.getTime() - dateA.getTime();
    });

  // Apply date filters
  let filtered = jsonFiles;
  if (options.fromDate || options.toDate) {
    filtered = jsonFiles.filter(f => {
      const date = parseFilename(f);
      if (!date) return false;
      if (options.fromDate && date < options.fromDate) return false;
      if (options.toDate && date > options.toDate) return false;
      return true;
    });
  }

  // Apply offset and limit
  const offset = options.offset || 0;
  const limit = options.limit || filtered.length;
  const selected = filtered.slice(offset, offset + limit);

  // Load summaries
  const summaryCandidates: Array<ChatSessionSummary | null> = await mapWithConcurrency(
    selected,
    HISTORY_READ_CONCURRENCY,
    async (filename) => {
      try {
        const session = await loadChatSession(filename);
        if (!session) {
          return null;
        }

        // Apply symbol filter
        if (options.symbols && options.symbols.length > 0) {
          const hasSymbol = options.symbols.some(s =>
            session.symbolsDiscussed.includes(s.toUpperCase())
          );
          if (!hasSymbol) {
            return null;
          }
        }

        // Get preview message (first user message)
        const firstUserMsg = session.messages.find(m => m.role === "user");

        const summary: ChatSessionSummary = {
          id: session.id,
          filename,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          messageCount: session.metadata.messageCount,
          symbolsDiscussed: session.symbolsDiscussed,
          ...(firstUserMsg ? { previewMessage: firstUserMsg.content.slice(0, 100) } : {}),
        };
        return summary;
      } catch {
        // Skip corrupted files
        return null;
      }
    }
  );

  return summaryCandidates.filter((summary): summary is ChatSessionSummary => summary !== null);
}

/**
 * Delete a chat session
 */
export async function deleteChatSession(filename: string): Promise<boolean> {
  const filepath = join(HISTORY_DIR, filename);

  try {
    await unlink(filepath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Delete old sessions (cleanup)
 */
export async function cleanupOldSessions(options: {
  /** Keep sessions from the last N days (default: 30) */
  keepDays?: number;
  /** Maximum number of sessions to keep (default: 100) */
  maxSessions?: number;
}): Promise<{ deleted: number; kept: number }> {
  const keepDays = options.keepDays ?? 30;
  const maxSessions = options.maxSessions ?? 100;

  const sessions = await listChatSessions();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - keepDays);

  let deleted = 0;
  let kept = 0;

  for (const session of sessions) {
    const sessionDate = new Date(session.startedAt);
    const isTooOld = sessionDate < cutoffDate;
    const isOverLimit = kept >= maxSessions;

    if (isTooOld || isOverLimit) {
      await deleteChatSession(session.filename);
      deleted++;
    } else {
      kept++;
    }
  }

  return { deleted, kept };
}

/**
 * Search chat history for messages containing a query
 */
export async function searchChatHistory(
  query: string,
  options: {
    limit?: number;
    caseSensitive?: boolean;
  } = {}
): Promise<Array<{
  session: ChatSessionSummary;
  matches: Array<{
    messageIndex: number;
    role: string;
    content: string;
    timestamp: string;
  }>;
}>> {
  const sessions = await listChatSessions({ limit: options.limit || 50 });
  const results: Array<{
    session: ChatSessionSummary;
    matches: Array<{
      messageIndex: number;
      role: string;
      content: string;
      timestamp: string;
    }>;
  }> = [];

  const searchQuery = options.caseSensitive ? query : query.toLowerCase();

  const perSessionResults = await mapWithConcurrency(
    sessions,
    HISTORY_READ_CONCURRENCY,
    async (summary) => {
      const session = await loadChatSession(summary.filename);
      if (!session) {
        return null;
      }

      const matches: Array<{
        messageIndex: number;
        role: string;
        content: string;
        timestamp: string;
      }> = [];

      for (let i = 0; i < session.messages.length; i++) {
        const msg = session.messages[i]!;
        const content = options.caseSensitive ? msg.content : msg.content.toLowerCase();

        if (content.includes(searchQuery)) {
          matches.push({
            messageIndex: i,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
          });
        }
      }

      if (matches.length === 0) {
        return null;
      }

      return { session: summary, matches };
    }
  );

  results.push(
    ...perSessionResults.filter(
      (entry): entry is {
        session: ChatSessionSummary;
        matches: Array<{
          messageIndex: number;
          role: string;
          content: string;
          timestamp: string;
        }>;
      } => entry !== null
    )
  );

  return results;
}

/**
 * Get statistics about chat history
 */
export async function getChatHistoryStats(): Promise<{
  totalSessions: number;
  totalMessages: number;
  mostDiscussedSymbols: Array<{ symbol: string; count: number }>;
  mostUsedCommands: Array<{ command: string; count: number }>;
  averageSessionDuration: number;
  oldestSession: string | null;
  newestSession: string | null;
}> {
  const sessions = await listChatSessions();

  if (sessions.length === 0) {
    return {
      totalSessions: 0,
      totalMessages: 0,
      mostDiscussedSymbols: [],
      mostUsedCommands: [],
      averageSessionDuration: 0,
      oldestSession: null,
      newestSession: null,
    };
  }

  const symbolCounts = new Map<string, number>();
  const commandCounts = new Map<string, number>();
  let totalMessages = 0;
  let totalDuration = 0;

  const loadedSessions = await mapWithConcurrency(
    sessions,
    HISTORY_READ_CONCURRENCY,
    async (summary) => loadChatSession(summary.filename)
  );

  for (const session of loadedSessions) {
    if (!session) {
      continue;
    }

    totalMessages += session.metadata.messageCount;
    totalDuration += session.metadata.durationSeconds;

    for (const symbol of session.symbolsDiscussed) {
      symbolCounts.set(symbol, (symbolCounts.get(symbol) || 0) + 1);
    }

    for (const command of session.commandsUsed) {
      commandCounts.set(command, (commandCounts.get(command) || 0) + 1);
    }
  }

  const sortedSymbols = Array.from(symbolCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([symbol, count]) => ({ symbol, count }));

  const sortedCommands = Array.from(commandCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([command, count]) => ({ command, count }));

  return {
    totalSessions: sessions.length,
    totalMessages,
    mostDiscussedSymbols: sortedSymbols,
    mostUsedCommands: sortedCommands,
    averageSessionDuration: sessions.length > 0 ? Math.floor(totalDuration / sessions.length) : 0,
    oldestSession: sessions[sessions.length - 1]?.startedAt || null,
    newestSession: sessions[0]?.startedAt || null,
  };
}

/**
 * Export chat history to a single JSON file
 */
export async function exportChatHistory(options: {
  fromDate?: Date;
  toDate?: Date;
  outputPath?: string;
} = {}): Promise<string> {
  const sessions = await listChatSessions({
    fromDate: options.fromDate,
    toDate: options.toDate,
  });

  const loadedSessions = await mapWithConcurrency(
    sessions,
    HISTORY_READ_CONCURRENCY,
    async (summary) => loadChatSession(summary.filename)
  );
  const fullSessions = loadedSessions.filter((session): session is ChatSession => session !== null);

  const exportData = {
    exportedAt: new Date().toISOString(),
    sessionCount: fullSessions.length,
    sessions: fullSessions,
  };

  const outputPath = options.outputPath || join(GORDON_DIR, `history-export-${Date.now()}.json`);
  await Bun.write(outputPath, JSON.stringify(exportData, null, 2));

  return outputPath;
}
