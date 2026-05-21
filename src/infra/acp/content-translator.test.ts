import { describe, it, expect } from "bun:test";
import { extractMultimodalPrompt } from "./content-translator.ts";
import type { PromptRequest } from "@agentclientprotocol/sdk";

describe("extractMultimodalPrompt", () => {
  it("returns empty when prompt array is missing", () => {
    const result = extractMultimodalPrompt({ sessionId: "s", prompt: [] as never });
    expect(result.text).toBe("");
    expect(result.attachments).toEqual([]);
  });

  it("concatenates text items with newline separator", () => {
    const result = extractMultimodalPrompt({
      sessionId: "s",
      prompt: [
        { type: "text", text: "line 1" },
        { type: "text", text: "line 2" },
      ],
    } as unknown as PromptRequest);
    expect(result.text).toBe("line 1\nline 2");
  });

  it("extracts image attachments + surfaces placeholder in text", () => {
    const result = extractMultimodalPrompt({
      sessionId: "s",
      prompt: [
        { type: "text", text: "look at this:" },
        { type: "image", data: "iVBORw0KGgo...", mimeType: "image/png" },
      ],
    } as unknown as PromptRequest);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toEqual({
      kind: "image",
      data: "iVBORw0KGgo...",
      mimeType: "image/png",
    });
    expect(result.text).toContain("look at this:");
    expect(result.text).toContain("[image: image/png]");
  });

  it("extracts audio attachments + surfaces placeholder", () => {
    const result = extractMultimodalPrompt({
      sessionId: "s",
      prompt: [
        { type: "audio", data: "RIFF...", mimeType: "audio/wav" },
      ],
    } as unknown as PromptRequest);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.kind).toBe("audio");
    expect(result.text).toContain("[audio: audio/wav]");
  });

  it("uses default mimeType when missing on image", () => {
    const result = extractMultimodalPrompt({
      sessionId: "s",
      prompt: [{ type: "image", data: "abc" }],
    } as unknown as PromptRequest);
    expect((result.attachments[0] as { mimeType: string }).mimeType).toBe("image/png");
  });

  it("skips image items without data", () => {
    const result = extractMultimodalPrompt({
      sessionId: "s",
      prompt: [{ type: "image", data: "" }],
    } as unknown as PromptRequest);
    expect(result.attachments).toHaveLength(0);
  });

  it("surfaces resource_link as [file: <uri>]", () => {
    const result = extractMultimodalPrompt({
      sessionId: "s",
      prompt: [
        { type: "text", text: "see:" },
        { type: "resource_link", uri: "file:///tmp/strategy.ts", name: "strategy.ts" },
      ],
    } as unknown as PromptRequest);
    expect(result.text).toContain("[file: file:///tmp/strategy.ts]");
  });

  it("inlines text resources into the prompt text", () => {
    const result = extractMultimodalPrompt({
      sessionId: "s",
      prompt: [
        {
          type: "resource",
          resource: {
            uri: "file:///x.md",
            mimeType: "text/markdown",
            text: "# inline content",
          },
        },
      ],
    } as unknown as PromptRequest);
    expect(result.text).toContain("[resource file:///x.md]");
    expect(result.text).toContain("# inline content");
    expect(result.attachments).toHaveLength(1);
  });

  it("surfaces binary resources as placeholders (no inline text)", () => {
    const result = extractMultimodalPrompt({
      sessionId: "s",
      prompt: [
        {
          type: "resource",
          resource: {
            uri: "file:///chart.png",
            mimeType: "image/png",
          },
        },
      ],
    } as unknown as PromptRequest);
    expect(result.text).toContain("[resource: file:///chart.png (image/png)]");
  });

  it("skips unknown content types silently", () => {
    const result = extractMultimodalPrompt({
      sessionId: "s",
      prompt: [
        { type: "text", text: "ok" },
        { type: "fancy_future_type", payload: "ignored" },
      ],
    } as unknown as PromptRequest);
    expect(result.text).toBe("ok");
    expect(result.attachments).toHaveLength(0);
  });

  it("accepts raw strings as text items", () => {
    const result = extractMultimodalPrompt({
      sessionId: "s",
      prompt: ["raw string", { type: "text", text: "structured" }],
    } as unknown as PromptRequest);
    expect(result.text).toBe("raw string\nstructured");
  });
});
