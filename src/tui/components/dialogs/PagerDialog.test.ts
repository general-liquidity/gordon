import { describe, expect, test } from "bun:test";

import { findLastLongMessage, paginate } from "./PagerDialog.tsx";
import type { Message } from "../messages/MessageBubble.tsx";

function message(id: string, lineCount: number): Message {
  return {
    id,
    role: "system",
    content: Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join("\n"),
  };
}

describe("paginate", () => {
  test("splits lines into fixed-size pages", () => {
    const lines = Array.from({ length: 120 }, (_, i) => String(i + 1));
    const result = paginate(lines, 20);

    expect(result.pageCount).toBe(6);
    expect(result.pages).toHaveLength(6);
    expect(result.pages[5]).toHaveLength(20);
  });

  test("supports partial last pages and page size one", () => {
    expect(paginate(["a", "b", "c"], 2).pages).toEqual([["a", "b"], ["c"]]);
    expect(paginate(["a", "b"], 1)).toEqual({ pages: [["a"], ["b"]], pageCount: 2 });
  });

  test("returns one empty page for empty content", () => {
    expect(paginate([], 20)).toEqual({ pages: [[]], pageCount: 1 });
  });
});

describe("findLastLongMessage", () => {
  test("returns the newest message above the threshold", () => {
    const messages = [message("short", 5), message("old-long", 61), message("new-long", 80)];

    expect(findLastLongMessage(messages, 60)?.id).toBe("new-long");
  });

  test("skips short messages", () => {
    expect(findLastLongMessage([message("a", 2), message("b", 3)], 60)).toBeNull();
  });
});
