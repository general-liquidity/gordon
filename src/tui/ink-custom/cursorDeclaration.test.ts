import { describe, expect, it } from "bun:test";

import { createCursorDeclarationManager } from "./cursorDeclaration.ts";

describe("cursorDeclaration", () => {
  it("emits an empty string by default", () => {
    const manager = createCursorDeclarationManager();
    expect(manager.current).toBeNull();
    expect(manager.emit()).toBe("");
  });

  it("declare(row, col) produces a 1-indexed CUP sequence", () => {
    const manager = createCursorDeclarationManager();
    manager.declare(3, 7);
    expect(manager.current).toEqual({ row: 3, col: 7 });
    // Contract: 0-indexed input, ANSI is 1-indexed — row 3+1=4, col 7+1=8.
    expect(manager.emit()).toBe("\x1b[4;8H");
  });

  it("declare(0, 0) produces \\x1b[1;1H (home)", () => {
    const manager = createCursorDeclarationManager();
    manager.declare(0, 0);
    expect(manager.emit()).toBe("\x1b[1;1H");
  });

  it("clear() drops the declaration and emit() goes back to empty", () => {
    const manager = createCursorDeclarationManager();
    manager.declare(5, 12);
    expect(manager.emit()).toBe("\x1b[6;13H");

    manager.clear();
    expect(manager.current).toBeNull();
    expect(manager.emit()).toBe("");
  });

  it("re-declaring overwrites the previous position", () => {
    const manager = createCursorDeclarationManager();
    manager.declare(1, 2);
    manager.declare(9, 4);
    expect(manager.current).toEqual({ row: 9, col: 4 });
    expect(manager.emit()).toBe("\x1b[10;5H");
  });

  it("emit() is side-effect-free — repeated calls yield the same output", () => {
    const manager = createCursorDeclarationManager();
    manager.declare(2, 2);
    const first = manager.emit();
    const second = manager.emit();
    expect(first).toBe(second);
    expect(first).toBe("\x1b[3;3H");
  });
});
