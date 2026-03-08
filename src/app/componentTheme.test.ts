import { describe, expect, it } from "bun:test";

import { getAutocompleteTokens, getQuickActionTokens, getWorkflowAccent } from "./componentTheme.ts";

describe("component theme tokens", () => {
  it("maps workflows to distinct semantic accents", () => {
    expect(getWorkflowAccent("discover")).not.toBe(getWorkflowAccent("trade"));
    expect(getWorkflowAccent("analyze")).not.toBe(getWorkflowAccent("operate"));
  });

  it("returns quick action tokens without collapsing to one generic accent", () => {
    const selected = getQuickActionTokens("discover", true);
    const idle = getQuickActionTokens("discover", false);

    expect(selected.cue).not.toBe(idle.cue);
    expect(selected.command).toBe(getWorkflowAccent("discover"));
  });

  it("returns autocomplete tokens for selected commands", () => {
    const tokens = getAutocompleteTokens("trade", true);

    expect(tokens.accent).toBe(getWorkflowAccent("trade"));
    expect(tokens.label).toBeDefined();
  });
});
