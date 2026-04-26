import { describe, it, expect } from "bun:test";
import {
  buildAgentListAttachment,
  shouldRefreshAgentList,
} from "./agentListAttachment.ts";

describe("buildAgentListAttachment", () => {
  it("renders entries under the canonical header", () => {
    const a = buildAgentListAttachment([
      { id: "executor", description: "places trades" },
      { id: "researcher", description: "scans markets" },
    ]);
    expect(a.role).toBe("system");
    expect(a.content).toContain("[GORDON_AGENT_LIST]");
    expect(a.content).toContain("executor: places trades");
    expect(a.content).toContain("researcher: scans markets");
  });

  it("sorts entries by id (stable across input orderings)", () => {
    const a1 = buildAgentListAttachment([
      { id: "z", description: "z agent" },
      { id: "a", description: "a agent" },
    ]);
    const a2 = buildAgentListAttachment([
      { id: "a", description: "a agent" },
      { id: "z", description: "z agent" },
    ]);
    expect(a1.content).toBe(a2.content);
    expect(a1.fingerprint).toBe(a2.fingerprint);
  });

  it("renders tag annotations when present", () => {
    const a = buildAgentListAttachment([
      { id: "fork:btc", description: "BTC analyst fork", tags: ["fork", "research"] },
    ]);
    expect(a.content).toContain("[fork, research]");
  });

  it("excludes entries with available=false", () => {
    const a = buildAgentListAttachment([
      { id: "off", description: "disabled agent", available: false },
      { id: "on", description: "enabled agent" },
    ]);
    expect(a.content).not.toContain("off:");
    expect(a.content).toContain("on:");
  });

  it("truncates when body exceeds maxChars", () => {
    const longEntries = Array.from({ length: 200 }, (_, i) => ({
      id: `agent-${i.toString().padStart(3, "0")}`,
      description: "x".repeat(50),
    }));
    const a = buildAgentListAttachment(longEntries, { maxChars: 500 });
    expect(a.content.length).toBeLessThanOrEqual(500);
    expect(a.content).toContain("[truncated]");
  });

  it("respects custom header", () => {
    const a = buildAgentListAttachment([{ id: "x", description: "y" }], {
      header: "<my_agents>",
    });
    expect(a.content.startsWith("<my_agents>")).toBe(true);
  });

  it("produces a stable fingerprint for identical surfaces", () => {
    const entries = [
      { id: "a", description: "alpha" },
      { id: "b", description: "beta" },
    ];
    const a1 = buildAgentListAttachment(entries);
    const a2 = buildAgentListAttachment(entries);
    expect(a1.fingerprint).toBe(a2.fingerprint);
  });

  it("changes fingerprint when description changes", () => {
    const a1 = buildAgentListAttachment([{ id: "a", description: "v1" }]);
    const a2 = buildAgentListAttachment([{ id: "a", description: "v2" }]);
    expect(a1.fingerprint).not.toBe(a2.fingerprint);
  });

  it("ignores disabled entries when computing fingerprint", () => {
    const a1 = buildAgentListAttachment([
      { id: "a", description: "alpha" },
    ]);
    const a2 = buildAgentListAttachment([
      { id: "a", description: "alpha" },
      { id: "off", description: "disabled", available: false },
    ]);
    expect(a1.fingerprint).toBe(a2.fingerprint);
  });
});

describe("shouldRefreshAgentList", () => {
  it("returns true when no previous fingerprint exists", () => {
    const a = buildAgentListAttachment([{ id: "x", description: "y" }]);
    expect(shouldRefreshAgentList(a, undefined)).toBe(true);
  });

  it("returns false when fingerprint matches", () => {
    const a = buildAgentListAttachment([{ id: "x", description: "y" }]);
    expect(shouldRefreshAgentList(a, a.fingerprint)).toBe(false);
  });

  it("returns true when fingerprint differs", () => {
    const a = buildAgentListAttachment([{ id: "x", description: "y" }]);
    expect(shouldRefreshAgentList(a, "deadbeef")).toBe(true);
  });
});
