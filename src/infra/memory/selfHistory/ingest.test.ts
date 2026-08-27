import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadCatalog, refreshIndex, sessionToRecords, type RefreshOptions } from "./ingest.ts";
import type { ChatSession } from "../../storage/entities/chat-history.ts";

let historyDir: string;
let indexDir: string;
let opts: RefreshOptions;

function makeSession(
  id: string,
  messages: Array<{ role: string; content: string; agent?: string }>,
): ChatSession {
  return {
    id,
    startedAt: "2026-06-01T10:00:00.000Z",
    endedAt: "2026-06-01T10:30:00.000Z",
    messages: messages.map((m, i) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
      timestamp: `2026-06-01T10:0${i}:00.000Z`,
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
}

function writeSession(filename: string, session: ChatSession, mtimeSec: number): void {
  const path = join(historyDir, filename);
  writeFileSync(path, JSON.stringify(session), "utf-8");
  utimesSync(path, mtimeSec, mtimeSec);
}

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "gordon-selfhist-"));
  historyDir = join(base, "history");
  indexDir = join(base, "history-index");
  mkdirSync(historyDir, { recursive: true });
  opts = { historyDir, indexDir };
});

afterEach(() => {
  try {
    rmSync(join(historyDir, ".."), { recursive: true, force: true });
  } catch {
    // best effort
  }
});

describe("sessionToRecords", () => {
  test("maps each non-empty message to a citation-carrying record", () => {
    const session = makeSession("2026-06-01_10-00-00", [
      { role: "user", content: "analyze SOL microstructure" },
      { role: "assistant", content: "SOL order book looks thin", agent: "researcher" },
      { role: "user", content: "   " }, // whitespace-only — skipped
    ]);
    const records = sessionToRecords(session);
    expect(records).toHaveLength(2);
    expect(records[0]!.id).toBe("2026-06-01_10-00-00#0");
    expect(records[0]!.messageIndex).toBe(0);
    expect(records[0]!.role).toBe("user");
    expect(records[1]!.id).toBe("2026-06-01_10-00-00#1");
    expect(records[1]!.agent).toBe("researcher");
    expect(records[1]!.timestamp).toBe(new Date("2026-06-01T10:01:00.000Z").getTime());
  });
});

describe("refreshIndex — first pass", () => {
  test("indexes all present session files and flattens records", () => {
    writeSession("a.json", makeSession("a", [{ role: "user", content: "hello world" }]), 1000);
    writeSession("b.json", makeSession("b", [{ role: "user", content: "second session" }]), 1000);

    const report = refreshIndex(opts);
    expect(report.indexed.sort()).toEqual(["a.json", "b.json"]);
    expect(report.reused).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.records).toHaveLength(2);
    expect(existsSync(join(indexDir, "catalog.json"))).toBe(true);
  });
});

describe("refreshIndex — incremental re-index only touches changed files", () => {
  test("unchanged files are reused, only the modified file is re-parsed", () => {
    writeSession("a.json", makeSession("a", [{ role: "user", content: "alpha content" }]), 1000);
    writeSession("b.json", makeSession("b", [{ role: "user", content: "beta content" }]), 1000);

    const first = refreshIndex(opts);
    expect(first.indexed.sort()).toEqual(["a.json", "b.json"]);

    // Second pass, nothing changed → both reused, nothing re-parsed.
    const second = refreshIndex(opts);
    expect(second.indexed).toHaveLength(0);
    expect(second.reused.sort()).toEqual(["a.json", "b.json"]);

    // Modify only a.json (new content + newer mtime).
    writeSession(
      "a.json",
      makeSession("a", [{ role: "user", content: "alpha content revised" }]),
      2000,
    );

    const third = refreshIndex(opts);
    expect(third.indexed).toEqual(["a.json"]);
    expect(third.reused).toEqual(["b.json"]);

    // Catalog reflects the revised content.
    const catalog = loadCatalog(indexDir);
    expect(catalog.files["a.json"]!.records[0]!.content).toBe("alpha content revised");
  });

  test("a touch (mtime change, identical bytes) is reused, not re-parsed", () => {
    writeSession("a.json", makeSession("a", [{ role: "user", content: "stable content" }]), 1000);
    refreshIndex(opts);

    // Same bytes, later mtime — the sha256 confirm path should reuse.
    const session = makeSession("a", [{ role: "user", content: "stable content" }]);
    writeFileSync(join(historyDir, "a.json"), JSON.stringify(session), "utf-8");
    utimesSync(join(historyDir, "a.json"), 3000, 3000);

    const report = refreshIndex(opts);
    expect(report.indexed).toHaveLength(0);
    expect(report.reused).toEqual(["a.json"]);
  });
});

describe("refreshIndex — deleted sessions", () => {
  test("removed files drop from the catalog and records", () => {
    writeSession("a.json", makeSession("a", [{ role: "user", content: "keep me" }]), 1000);
    writeSession("b.json", makeSession("b", [{ role: "user", content: "delete me" }]), 1000);
    refreshIndex(opts);

    unlinkSync(join(historyDir, "b.json"));

    const report = refreshIndex(opts);
    expect(report.removed).toEqual(["b.json"]);
    expect(report.records).toHaveLength(1);
    expect(report.records[0]!.sessionId).toBe("a");
    expect(loadCatalog(indexDir).files["b.json"]).toBeUndefined();
  });
});

describe("refreshIndex — corrupt files", () => {
  test("skips unparseable files without throwing", () => {
    writeSession("good.json", makeSession("good", [{ role: "user", content: "valid" }]), 1000);
    writeFileSync(join(historyDir, "bad.json"), "{not valid json", "utf-8");
    utimesSync(join(historyDir, "bad.json"), 1000, 1000);

    const report = refreshIndex(opts);
    expect(report.records).toHaveLength(1);
    expect(report.records[0]!.sessionId).toBe("good");
  });
});
