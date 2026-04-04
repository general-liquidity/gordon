// ============================================================================
// Transcript Search Engine — In-conversation search with match navigation
//
// Case-insensitive substring matching. WeakMap-cached lowercase text per
// message. Supports nextMatch/prevMatch with wrap-around.
// ============================================================================

export interface SearchResult {
  messageIndex: number;
  matchStart: number;
  matchEnd: number;
}

interface Message {
  id?: string;
  content?: string;
  role?: string;
}

const textCache = new WeakMap<Message, string>();

function getMessageText(msg: Message): string {
  if (textCache.has(msg)) return textCache.get(msg)!;
  const text = (msg.content ?? "").toLowerCase();
  textCache.set(msg, text);
  return text;
}

export class TranscriptSearchEngine {
  private messages: Message[] = [];

  setMessages(messages: Message[]): void {
    this.messages = messages;
  }

  search(query: string): SearchResult[] {
    if (!query) return [];
    const lower = query.toLowerCase();
    const results: SearchResult[] = [];

    for (let i = 0; i < this.messages.length; i++) {
      const text = getMessageText(this.messages[i]!);
      let start = 0;
      while (true) {
        const idx = text.indexOf(lower, start);
        if (idx === -1) break;
        results.push({ messageIndex: i, matchStart: idx, matchEnd: idx + lower.length });
        start = idx + 1;
      }
    }

    return results;
  }

  getMatchCount(query: string): number {
    return this.search(query).length;
  }

  nextMatch(currentIndex: number, query: string): number {
    const results = this.search(query);
    if (results.length === 0) return -1;
    const next = results.find((r) => r.messageIndex > currentIndex);
    return next ? next.messageIndex : results[0]!.messageIndex;
  }

  prevMatch(currentIndex: number, query: string): number {
    const results = this.search(query);
    if (results.length === 0) return -1;
    const reversed = [...results].reverse();
    const prev = reversed.find((r) => r.messageIndex < currentIndex);
    return prev ? prev.messageIndex : reversed[0]!.messageIndex;
  }
}
