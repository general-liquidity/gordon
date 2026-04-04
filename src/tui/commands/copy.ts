// ============================================================================
// Copy Command — Copy last response or specific code block to clipboard
//
// Uses OSC 52 clipboard + native pbcopy/xclip/clip.exe fallback.
// ============================================================================

import { writeToClipboard } from "../hooks/useCopyOnSelect.js";

interface Message {
  role?: string;
  content?: string;
}

export function copyToClipboard(text: string): boolean {
  return writeToClipboard(text);
}

export function copyLastResponse(messages: Message[]): { success: boolean; text: string } {
  // Find last assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === "assistant" && msg.content) {
      const success = writeToClipboard(msg.content);
      return { success, text: msg.content };
    }
  }
  return { success: false, text: "" };
}

export function copyCodeBlock(messages: Message[], blockIndex = 0): { success: boolean; text: string } {
  // Find last assistant message and extract code blocks
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === "assistant" && msg.content) {
      const codeBlocks = extractCodeBlocks(msg.content);
      if (codeBlocks.length > blockIndex) {
        const block = codeBlocks[blockIndex]!;
        const success = writeToClipboard(block.code);
        return { success, text: block.code };
      }
    }
  }
  return { success: false, text: "" };
}

interface CodeBlock {
  language: string;
  code: string;
}

function extractCodeBlocks(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    blocks.push({
      language: match[1] ?? "",
      code: match[2] ?? "",
    });
  }
  return blocks;
}
