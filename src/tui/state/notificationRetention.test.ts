import { describe, expect, test } from "bun:test";
import { appendNotificationCapped, MAX_TUI_NOTIFICATIONS } from "./notificationRetention.ts";

describe("appendNotificationCapped", () => {
  test("appends to undefined list", () => {
    expect(appendNotificationCapped(undefined, "a")).toEqual(["a"]);
  });

  test("appends without dropping below the cap", () => {
    const out = appendNotificationCapped(["a", "b"], "c");
    expect(out).toEqual(["a", "b", "c"]);
  });

  test("drops oldest entries beyond the cap", () => {
    let list: string[] = [];
    for (let i = 0; i < MAX_TUI_NOTIFICATIONS + 10; i++) {
      list = appendNotificationCapped(list, `n${i}`);
    }
    expect(list.length).toBe(MAX_TUI_NOTIFICATIONS);
    expect(list[0]).toBe("n10");
    expect(list[list.length - 1]).toBe(`n${MAX_TUI_NOTIFICATIONS + 9}`);
  });

  test("honors a custom cap", () => {
    const out = appendNotificationCapped(["a", "b", "c"], "d", 2);
    expect(out).toEqual(["c", "d"]);
  });

  test("does not mutate the input list", () => {
    const input = ["a"];
    appendNotificationCapped(input, "b");
    expect(input).toEqual(["a"]);
  });
});
