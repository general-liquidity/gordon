/**
 * Multimodal LLM bridge for ACP v3.5.
 *
 * Gordon's LLM client API (`infra/ai/llm/client.ts`) takes
 * `Message[] = { role, content: string }` — text-only. ACP v3 extracts
 * image/audio attachments from prompt items; this module decides how
 * to pass them to the LLM.
 *
 * Two paths:
 *
 *   1. **Inline-text path (default in v3.5)** — formats each attachment
 *      as a textual description ([image: <mime>, <size>B], [audio: ...])
 *      and prepends to the user prompt. The LLM doesn't see the actual
 *      pixels/audio, but knows they were attached. Works on every
 *      provider, including text-only models.
 *
 *   2. **Content-block translators (deferred)** — when the Gordon LLM
 *      client gains content-block support (Anthropic image blocks,
 *      OpenAI vision input_image), the attachments would be passed
 *      verbatim. This module exposes `toAnthropicContentBlocks` +
 *      `toOpenAIContentParts` as ready-to-use translators so the v3.6
 *      flip is mechanical.
 *
 * The production path is currently `inline`. Setting
 * `GORDON_ACP_VISION_PATH=blocks` fails explicitly: accepting that setting
 * while the production handler still has a string-only LLM boundary would
 * silently discard the attachment payload. The converter functions remain
 * exported so the future content-block integration has one tested boundary.
 */

import type { MultimodalAttachment } from "./content-translator.ts";

export const VISION_PATH_ENV = "GORDON_ACP_VISION_PATH";

export type VisionPath = "inline" | "blocks";

export function resolveVisionPath(env: NodeJS.ProcessEnv = process.env): VisionPath {
  const configured = env[VISION_PATH_ENV]?.trim().toLowerCase();
  if (!configured || configured === "inline") return "inline";
  if (configured === "blocks") {
    throw new Error(
      `${VISION_PATH_ENV}=blocks is not supported by Gordon's string-only production LLM boundary; use inline until content-block transport is wired`,
    );
  }
  throw new Error(`${VISION_PATH_ENV} must be "inline" when set; received ${JSON.stringify(configured)}`);
}

/**
 * Format a single attachment as a textual descriptor for inline-text
 * mode. Returns a short tag the LLM can reference but doesn't carry
 * the binary payload.
 */
export function describeAttachment(att: MultimodalAttachment): string {
  switch (att.kind) {
    case "image": {
      const bytes = att.data ? Math.floor((att.data.length * 3) / 4) : 0; // base64 → approx bytes
      return `[image: ${att.mimeType}, ~${bytes}B base64-encoded]`;
    }
    case "audio": {
      const bytes = att.data ? Math.floor((att.data.length * 3) / 4) : 0;
      return `[audio: ${att.mimeType}, ~${bytes}B base64-encoded]`;
    }
    case "resource": {
      if (att.inlineText) {
        return `[resource ${att.uri}]\n${att.inlineText}`;
      }
      return `[resource: ${att.uri}${att.mimeType ? ` (${att.mimeType})` : ""}]`;
    }
  }
}

/**
 * Inline-text rendering — joins all attachment descriptors with the
 * user prompt. The descriptors come BEFORE the prompt text so the LLM
 * reads the context first, then the question.
 */
export function renderInlineTextPrompt(
  prompt: string,
  attachments: MultimodalAttachment[],
): string {
  if (attachments.length === 0) return prompt;
  const descriptors = attachments.map(describeAttachment).join("\n");
  return `${descriptors}\n\n${prompt}`;
}

// ---------------------------------------------------------------------------
// Content-block translators — ready for v3.6 LLM client support
// ---------------------------------------------------------------------------

/**
 * Anthropic image-block format:
 *   { type: "image", source: { type: "base64", media_type, data } }
 */
export interface AnthropicImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export type AnthropicContentBlock = AnthropicImageBlock | AnthropicTextBlock;

export function toAnthropicContentBlocks(
  prompt: string,
  attachments: MultimodalAttachment[],
): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  for (const att of attachments) {
    if (att.kind === "image") {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: att.mimeType, data: att.data },
      });
    } else {
      blocks.push({ type: "text", text: describeAttachment(att) });
    }
  }
  blocks.push({ type: "text", text: prompt });
  return blocks;
}

/**
 * OpenAI vision content-parts format:
 *   { type: "image_url", image_url: { url: "data:<mime>;base64,<data>" } }
 */
export interface OpenAIImageContentPart {
  type: "image_url";
  image_url: { url: string };
}

export interface OpenAITextContentPart {
  type: "text";
  text: string;
}

export type OpenAIContentPart = OpenAIImageContentPart | OpenAITextContentPart;

export function toOpenAIContentParts(
  prompt: string,
  attachments: MultimodalAttachment[],
): OpenAIContentPart[] {
  const parts: OpenAIContentPart[] = [];
  for (const att of attachments) {
    if (att.kind === "image") {
      parts.push({
        type: "image_url",
        image_url: { url: `data:${att.mimeType};base64,${att.data}` },
      });
    } else {
      parts.push({ type: "text", text: describeAttachment(att) });
    }
  }
  parts.push({ type: "text", text: prompt });
  return parts;
}
