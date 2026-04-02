import { describe, expect, it } from "bun:test";

import {
  getNextWorkspace,
  getPreviousWorkspace,
  getWorkspaceByShortcut,
} from "./workspaces.ts";

describe("workspace navigation helpers", () => {
  it("cycles across the full workspace ring", () => {
    expect(getNextWorkspace("desk")).toBe("market");
    expect(getNextWorkspace("monitor")).toBe("desk");
    expect(getPreviousWorkspace("desk")).toBe("monitor");
    expect(getPreviousWorkspace("market")).toBe("desk");
  });

  it("maps numeric shortcuts to the correct workspaces", () => {
    expect(getWorkspaceByShortcut("1")).toBe("desk");
    expect(getWorkspaceByShortcut("2")).toBe("market");
    expect(getWorkspaceByShortcut("5")).toBe("monitor");
    expect(getWorkspaceByShortcut("0")).toBeNull();
    expect(getWorkspaceByShortcut("8")).toBeNull();
  });
});
