/**
 * Multimodal content translator for ACP prompt items.
 *
 * v3 expands what Gordon accepts in `prompt` requests beyond plain text:
 *
 *   - text             { type: "text", text }
 *   - image            { type: "image", data, mimeType }
 *   - audio            { type: "audio", data, mimeType }
 *   - resource         { type: "resource", resource: { text/blob } }
 *   - resource_link    { type: "resource_link", uri, name? }
 *
 * Gordon's downstream LLM clients (Anthropic, OpenAI, Google) support
 * vision (image) and partial audio. For v3 we:
 *   - Extract text content directly
 *   - Surface image/audio as a typed entry in the structured result so
 *     downstream callers can choose to: (a) pass to a vision-capable
 *     LLM, or (b) describe as a placeholder when routing to text-only
 *     models. Gordon's defaultPromptHandler keeps the placeholder-as-
 *     text approach for now (deferred multimodal LLM wiring is v3.5
 *     follow-up work).
 *   - Resource (inline) items become text or are flagged as binary
 *   - Resource links surface as `[file: <uri>]` placeholders (v2 behavior)
 *
 * The structured `MultimodalPrompt` return lets future work flip to
 * full multimodal LLM passing without changing this translator.
 */

import type { PromptRequest } from "@agentclientprotocol/sdk";

export interface MultimodalImagePart {
  kind: "image";
  data: string;
  mimeType: string;
}

export interface MultimodalAudioPart {
  kind: "audio";
  data: string;
  mimeType: string;
}

export interface MultimodalResourcePart {
  kind: "resource";
  uri: string;
  mimeType?: string;
  inlineText?: string;
}

export type MultimodalAttachment =
  | MultimodalImagePart
  | MultimodalAudioPart
  | MultimodalResourcePart;

export interface MultimodalPrompt {
  /** Concatenated text — fed into Gordon's text-mode handlers. */
  text: string;
  /** Non-text attachments preserved for multimodal-capable downstream consumers. */
  attachments: MultimodalAttachment[];
}

/**
 * Extract a MultimodalPrompt from an ACP PromptRequest. Image/audio
 * data is kept as-is (base64 strings). Resource links and text are
 * flattened into the `text` channel; inline-text resources are
 * appended to text; binary resources stay in attachments.
 */
export function extractMultimodalPrompt(params: PromptRequest): MultimodalPrompt {
  const textParts: string[] = [];
  const attachments: MultimodalAttachment[] = [];

  if (!params.prompt || !Array.isArray(params.prompt)) {
    return { text: "", attachments };
  }

  for (const item of params.prompt) {
    if (typeof item === "string") {
      textParts.push(item);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const type = obj.type;
    switch (type) {
      case "text": {
        if (typeof obj.text === "string") textParts.push(obj.text);
        break;
      }
      case "image": {
        const data = typeof obj.data === "string" ? obj.data : "";
        const mimeType = typeof obj.mimeType === "string" ? obj.mimeType : "image/png";
        if (data) {
          attachments.push({ kind: "image", data, mimeType });
          textParts.push(`[image: ${mimeType}]`);
        }
        break;
      }
      case "audio": {
        const data = typeof obj.data === "string" ? obj.data : "";
        const mimeType = typeof obj.mimeType === "string" ? obj.mimeType : "audio/wav";
        if (data) {
          attachments.push({ kind: "audio", data, mimeType });
          textParts.push(`[audio: ${mimeType}]`);
        }
        break;
      }
      case "resource_link": {
        const uri = typeof obj.uri === "string" ? obj.uri : "";
        if (uri) textParts.push(`[file: ${uri}]`);
        break;
      }
      case "resource": {
        const resource = obj.resource as Record<string, unknown> | undefined;
        if (!resource) break;
        const uri = typeof resource.uri === "string" ? resource.uri : "";
        const mimeType = typeof resource.mimeType === "string" ? resource.mimeType : undefined;
        const inlineText = typeof resource.text === "string" ? resource.text : undefined;
        attachments.push({
          kind: "resource",
          uri,
          mimeType,
          inlineText,
        });
        if (inlineText) {
          textParts.push(`[resource ${uri}]\n${inlineText}`);
        } else {
          textParts.push(`[resource: ${uri}${mimeType ? ` (${mimeType})` : ""}]`);
        }
        break;
      }
      default:
        // Unknown content type — skip silently
        break;
    }
  }

  return {
    text: textParts.join("\n"),
    attachments,
  };
}
