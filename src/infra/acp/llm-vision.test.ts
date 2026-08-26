import { describe, it, expect } from "bun:test";
import {
  resolveVisionPath,
  describeAttachment,
  renderInlineTextPrompt,
  toAnthropicContentBlocks,
  toOpenAIContentParts,
  VISION_PATH_ENV,
} from "./llm-vision.ts";
import type { MultimodalAttachment } from "./content-translator.ts";

describe("resolveVisionPath", () => {
  it("defaults to inline", () => {
    expect(resolveVisionPath({})).toBe("inline");
  });

  it("refuses blocks until the production LLM boundary can carry them", () => {
    expect(() => resolveVisionPath({ [VISION_PATH_ENV]: "blocks" })).toThrow(
      /not supported.*string-only production LLM boundary/,
    );
  });

  it("refuses unknown values instead of silently changing operator intent", () => {
    expect(() => resolveVisionPath({ [VISION_PATH_ENV]: "weird" })).toThrow(
      /must be "inline"/,
    );
  });
});

describe("describeAttachment", () => {
  it("describes image with mime + approx byte size", () => {
    const desc = describeAttachment({
      kind: "image",
      data: "abcdefgh", // 8 chars base64 → 6 bytes
      mimeType: "image/jpeg",
    });
    expect(desc).toContain("image/jpeg");
    expect(desc).toContain("6B");
  });

  it("describes audio with mime + byte size", () => {
    const desc = describeAttachment({
      kind: "audio",
      data: "abcdefgh",
      mimeType: "audio/mpeg",
    });
    expect(desc).toContain("audio/mpeg");
  });

  it("inlines text from resource attachments", () => {
    const desc = describeAttachment({
      kind: "resource",
      uri: "file:///x.md",
      mimeType: "text/markdown",
      inlineText: "# inline",
    });
    expect(desc).toContain("file:///x.md");
    expect(desc).toContain("# inline");
  });

  it("descriptors binary resources without inline text", () => {
    const desc = describeAttachment({
      kind: "resource",
      uri: "file:///chart.png",
      mimeType: "image/png",
    });
    expect(desc).toContain("[resource: file:///chart.png (image/png)]");
  });
});

describe("renderInlineTextPrompt", () => {
  it("passes prompt through unchanged when no attachments", () => {
    expect(renderInlineTextPrompt("hello", [])).toBe("hello");
  });

  it("prepends descriptors before prompt text", () => {
    const attachments: MultimodalAttachment[] = [
      { kind: "image", data: "abc", mimeType: "image/png" },
    ];
    const result = renderInlineTextPrompt("explain this", attachments);
    expect(result).toContain("[image: image/png");
    expect(result.indexOf("[image:")).toBeLessThan(result.indexOf("explain this"));
  });
});

describe("toAnthropicContentBlocks", () => {
  it("converts image attachments to Anthropic image blocks + appends text", () => {
    const blocks = toAnthropicContentBlocks("describe", [
      { kind: "image", data: "DATA_B64", mimeType: "image/png" },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "DATA_B64" },
    });
    expect(blocks[1]).toEqual({ type: "text", text: "describe" });
  });

  it("renders non-image attachments as text blocks", () => {
    const blocks = toAnthropicContentBlocks("foo", [
      { kind: "audio", data: "abc", mimeType: "audio/wav" },
    ]);
    expect(blocks[0]?.type).toBe("text");
    if (blocks[0]?.type === "text") expect(blocks[0].text).toContain("audio/wav");
  });
});

describe("toOpenAIContentParts", () => {
  it("converts image attachments to OpenAI image_url parts (data URL)", () => {
    const parts = toOpenAIContentParts("look", [
      { kind: "image", data: "ABC", mimeType: "image/png" },
    ]);
    expect(parts[0]?.type).toBe("image_url");
    if (parts[0]?.type === "image_url") {
      expect(parts[0].image_url.url).toBe("data:image/png;base64,ABC");
    }
    expect(parts[1]?.type).toBe("text");
  });
});
