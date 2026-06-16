import { describe, expect, it } from "bun:test";
import { LLMClient } from "./client.ts";
import { API_ENDPOINTS } from "./types.ts";

describe("Doubleword provider", () => {
  it("exposes the OpenAI-compatible base URL", () => {
    expect(API_ENDPOINTS.doubleword).toBe("https://api.doubleword.ai/v1");
  });

  it("a client with only a Doubleword key reports it available", () => {
    const c = new LLMClient({ doublewordApiKey: "dw-key", defaultProvider: "doubleword" });
    expect(c.hasProvider("doubleword")).toBe(true);
    expect(c.getAvailableProviders()).toContain("doubleword");
  });

  it("requires the Doubleword key when it is the default provider", () => {
    expect(() => new LLMClient({ openaiApiKey: "x", defaultProvider: "doubleword" })).toThrow(
      /Doubleword API key required/,
    );
  });

  it("still requires at least one provider key", () => {
    expect(() => new LLMClient({})).toThrow(/at least one API key/);
  });
});
