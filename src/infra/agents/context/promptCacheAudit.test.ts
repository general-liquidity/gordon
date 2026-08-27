import { describe, expect, it } from "bun:test";

import {
  auditCacheBlocks,
  formatCacheBlockAudit,
  captureAuditedRequest,
  getLatestAuditedRequest,
  resetLatestAuditedRequest,
} from "./promptCacheAudit.ts";
import type { GroundedPromptMessage } from "./contextBudget.ts";

const STABLE = "x".repeat(5000); // ~1250 tokens
const DYNAMIC = "y".repeat(800);

describe("auditCacheBlocks", () => {
  it("returns null hashes when no system messages are present", () => {
    const messages: GroundedPromptMessage[] = [{ role: "user", content: "hi" }];
    const result = auditCacheBlocks(messages, "anthropic");
    expect(result.stablePrefixHash).toBeNull();
    expect(result.dynamicBlockHash).toBeNull();
    expect(result.systemMessageCount).toBe(0);
    expect(result.notes.some((n) => n.includes("No system messages"))).toBe(true);
  });

  it("hashes the stable prefix and dynamic block when present", () => {
    const messages: GroundedPromptMessage[] = [
      { role: "system", content: STABLE },
      { role: "system", content: DYNAMIC },
      { role: "user", content: "hi" },
    ];
    const result = auditCacheBlocks(messages, "openai");
    expect(result.stablePrefixHash).not.toBeNull();
    expect(result.dynamicBlockHash).not.toBeNull();
    expect(result.systemMessageCount).toBe(2);
    expect(result.stablePrefixHash).not.toBe(result.dynamicBlockHash);
  });

  it("flags missing cache_control on Anthropic", () => {
    const messages: GroundedPromptMessage[] = [
      { role: "system", content: STABLE },
      { role: "user", content: "hi" },
    ];
    const result = auditCacheBlocks(messages, "anthropic");
    expect(result.cacheControlExpected).toBe(true);
    expect(result.cacheControlPresent).toBe(false);
    expect(result.notes.some((n) => /expects explicit cache_control/i.test(n))).toBe(true);
  });

  it("detects Anthropic providerOptions.cacheControl", () => {
    const messages: GroundedPromptMessage[] = [
      {
        role: "system",
        content: STABLE,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      } as unknown as GroundedPromptMessage,
      { role: "user", content: "hi" },
    ];
    const result = auditCacheBlocks(messages, "anthropic");
    expect(result.cacheControlPresent).toBe(true);
  });

  it("notes that openai uses automatic prefix caching", () => {
    const messages: GroundedPromptMessage[] = [
      { role: "system", content: STABLE },
      { role: "user", content: "hi" },
    ];
    const result = auditCacheBlocks(messages, "openai");
    expect(result.cacheControlExpected).toBe(false);
    expect(result.notes.some((n) => /automatic/i.test(n))).toBe(true);
  });

  it("flags small prefix as too short for cache hit on Anthropic", () => {
    const messages: GroundedPromptMessage[] = [
      { role: "system", content: "tiny prefix" },
      { role: "user", content: "hi" },
    ];
    const result = auditCacheBlocks(messages, "anthropic");
    expect(result.prefixLargeEnoughForCache).toBe(false);
    expect(result.notes.some((n) => /below the/i.test(n))).toBe(true);
  });

  it("formatCacheBlockAudit produces a readable report", () => {
    const messages: GroundedPromptMessage[] = [
      { role: "system", content: STABLE },
      { role: "system", content: DYNAMIC },
    ];
    const result = auditCacheBlocks(messages, "openai");
    const text = formatCacheBlockAudit(result);
    expect(text).toContain("Prompt Cache Audit");
    expect(text).toContain("Provider: openai");
    expect(text).toContain("Stable prefix hash:");
  });

  it("captureAuditedRequest stores and returns the latest request", () => {
    resetLatestAuditedRequest();
    expect(getLatestAuditedRequest()).toBeNull();
    const messages: GroundedPromptMessage[] = [{ role: "user", content: "hi" }];
    captureAuditedRequest(messages, "openai", "thread-1");
    const captured = getLatestAuditedRequest();
    expect(captured).not.toBeNull();
    expect(captured?.provider).toBe("openai");
    expect(captured?.threadId).toBe("thread-1");
    resetLatestAuditedRequest();
    expect(getLatestAuditedRequest()).toBeNull();
  });
});
