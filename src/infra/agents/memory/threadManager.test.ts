import { describe, expect, it } from "bun:test";
import { buildThreadTree, type ThreadInfo } from "./threadManager.ts";

describe("buildThreadTree", () => {
  it("orders threads into parent-child tree structure", () => {
    const threads: ThreadInfo[] = [
      {
        threadId: "root",
        resourceId: "user-1",
        createdAt: "2026-03-01T10:00:00.000Z",
        clonedFrom: null,
        label: "Main",
        messageCount: 10,
        lastActiveAt: "2026-03-01T12:00:00.000Z",
        isActive: false,
      },
      {
        threadId: "branch-a",
        resourceId: "user-1",
        createdAt: "2026-03-01T11:00:00.000Z",
        clonedFrom: "root",
        label: "BTC thesis",
        messageCount: 4,
        lastActiveAt: "2026-03-01T13:00:00.000Z",
        isActive: true,
      },
      {
        threadId: "branch-b",
        resourceId: "user-1",
        createdAt: "2026-03-01T11:30:00.000Z",
        clonedFrom: "branch-a",
        label: "BTC breakout",
        messageCount: 2,
        lastActiveAt: "2026-03-01T13:30:00.000Z",
        isActive: false,
      },
    ];

    const tree = buildThreadTree(threads);

    expect(tree.map((thread) => thread.threadId)).toEqual(["root", "branch-a", "branch-b"]);
    expect(tree.map((thread) => thread.depth)).toEqual([0, 1, 2]);
    expect(tree.map((thread) => thread.childCount)).toEqual([1, 1, 0]);
    expect(tree[1]?.isActive).toBe(true);
  });
});
