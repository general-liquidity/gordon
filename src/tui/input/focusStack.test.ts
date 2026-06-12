import { describe, expect, test } from "bun:test";
import { FocusStack } from "./focusStack.ts";
import type { Key } from "../ink-custom";

const key = {} as Key;

describe("FocusStack", () => {
  test("dispatches by priority and falls through on false", () => {
    const calls: string[] = [];
    const stack = new FocusStack();
    stack.register({ id: "chat", priority: 100, handler: () => { calls.push("chat"); } });
    stack.register({ id: "dialog", priority: 300, handler: () => { calls.push("dialog"); return false; } });

    expect(stack.dispatch("x", key)).toBe("chat");
    expect(calls).toEqual(["dialog", "chat"]);
  });

  test("uses registration recency as a tiebreaker", () => {
    const stack = new FocusStack();
    stack.register({ id: "old", priority: 100, handler: () => true });
    stack.register({ id: "new", priority: 100, handler: () => true });
    expect(stack.dispatch("", key)).toBe("new");
  });

  test("unregisters owners and skips inactive owners", () => {
    const stack = new FocusStack();
    const unregister = stack.register({ id: "dialog", priority: 300, handler: () => true });
    stack.register({ id: "inactive", priority: 400, isActive: () => false, handler: () => true });

    expect(stack.dispatch("", key)).toBe("dialog");
    unregister();
    expect(stack.dispatch("", key)).toBeNull();
  });
});
