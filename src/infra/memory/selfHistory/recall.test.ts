import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { searchSessionHistory } from "./recall.ts";
import type { ChatSession } from "../../storage/entities/chat-history.ts";

let historyDir: string;
let indexDir: string;
let base: string;

function recentIso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function writeSession(
  filename: string,
  id: string,
  messages: Array<{ role: string; content: string; agent?: string; minutesAgo: number }>,
): void {
  const session: ChatSession = {
    id,
    startedAt: recentIso(60),
    endedAt: recentIso(30),
    messages: messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
      timestamp: recentIso(m.minutesAgo),
      ...(m.agent ? { agent: m.agent } : {}),
    })),
    symbolsDiscussed: [],
    commandsUsed: [],
    metadata: {
      version: "1.0.0",
      permissionMode: "ask",
      messageCount: messages.length,
      durationSeconds: 1800,
    },
  };
  const path = join(historyDir, filename);
  writeFileSync(path, JSON.stringify(session), "utf-8");
  utimesSync(path, 1000, 1000);
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "gordon-recall-"));
  historyDir = join(base, "history");
  indexDir = join(base, "history-index");
  mkdirSync(historyDir, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

describe("searchSessionHistory", () => {
  test("recalls a past-session mention with a citation to the exact turn", () => {
    writeSession("s1.json", "2026-07-01_09-00-00", [
      { role: "user", content: "what do you think of BTC funding rates today", minutesAgo: 50 },
      { role: "assistant", content: "BTC funding is neutral, nothing notable", agent: "gordon", minutesAgo: 49 },
    ]);
    writeSession("s2.json", "2026-07-02_14-00-00", [
      { role: "user", content: "analyze SOL microstructure and order book depth", minutesAgo: 40 },
      {
        role: "assistant",
        content: "SOL microstructure shows thin bids below spot, toxicity elevated",
        agent: "researcher",
        minutesAgo: 39,
      },
    ]);

    const hits = searchSessionHistory("SOL microstructure conclusion", {
      historyDir,
      indexDir,
      limit: 5,
    });

    expect(hits.length).toBeGreaterThan(0);
    const top = hits[0]!;
    expect(top.sessionId).toBe("2026-07-02_14-00-00");
    // Citation points back at the exact message offset within that session.
    expect(top.citation.sessionId).toBe("2026-07-02_14-00-00");
    expect(typeof top.citation.messageIndex).toBe("number");
    expect(top.citation.timestamp).not.toBeNull();
  });

  test("every hit carries why_matched reasons naming the matched terms", () => {
    writeSession("s1.json", "2026-07-02_14-00-00", [
      { role: "user", content: "review the ETH breakout playbook and whether it fired", minutesAgo: 20 },
      {
        role: "assistant",
        content: "the ETH breakout playbook fired at 3400 and hit target",
        agent: "researcher",
        minutesAgo: 19,
      },
    ]);

    const hits = searchSessionHistory("ETH breakout playbook", { historyDir, indexDir, limit: 3 });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(Array.isArray(h.whyMatched)).toBe(true);
      expect(h.whyMatched.length).toBeGreaterThan(0);
    }
    // The top hit should name overlapping query terms.
    const reasons = hits[0]!.whyMatched.join(" ").toLowerCase();
    expect(reasons).toContain("matched terms");
    expect(reasons).toMatch(/eth|breakout|playbook/);
  });

  test("returns empty when there are no sessions", () => {
    const hits = searchSessionHistory("anything", { historyDir, indexDir });
    expect(hits).toEqual([]);
  });

  test("respects the limit", () => {
    for (let i = 0; i < 5; i++) {
      writeSession(`s${i}.json`, `sess-${i}`, [
        { role: "user", content: `session ${i} discussing momentum breakout signals`, minutesAgo: 10 + i },
      ]);
    }
    const hits = searchSessionHistory("momentum breakout signals", { historyDir, indexDir, limit: 2 });
    expect(hits.length).toBeLessThanOrEqual(2);
  });
});
