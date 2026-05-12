import React, { useMemo, useRef } from "react";
import { Box, Text } from "../../ink-custom";
import { CodeBlock } from "../display/CodeBlock.tsx";
import { TerminalLink } from "../layout/TerminalLink.tsx";
import { PALETTE, headingColor, findColorHits } from "./markdownPalette.js";

// ============================================================================
// StreamingMarkdown — Claude Code stable-prefix incremental rendering
//
// Key patterns from Claude Code's Markdown.tsx:
// 1. Stable prefix tracking — only re-lex the tail block, not full content
// 2. Proper hash cache with MRU promotion
// 3. Fast-path for plain text
// 4. Strip prompt XML tags
// 5. Line-by-line render (no in-progress line shown)
// ============================================================================

interface Props {
  content: string;
  isStreaming: boolean;
}

// Fast-path detector: any of these markers means we need full parsing.
const MD_SYNTAX_RE = /[#*`|[\]>\-_~]|\n\n|^\d+\. |\n\d+\. /;

// Simple hash for cache key (avoids retaining full content strings)
function hashContent(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0;
  }
  return `${h}:${content.length}`;
}

// LRU token cache with MRU promotion — 500 entries
const tokenCache = new Map<string, ParsedBlock[]>();
const TOKEN_CACHE_MAX = 500;

interface ParsedBlock {
  type: "text" | "heading" | "codeblock" | "blockquote" | "bullet" | "hr";
  content: string;
  level?: number;
  language?: string;
  raw: string; // Original text for stable prefix tracking
}

// Strip internal prompt XML tags that shouldn't be visible
function stripPromptXMLTags(text: string): string {
  return text.replace(/<\/?(?:user_context|system|assistant|tool_result|thinking|artifact)[^>]*>/g, "");
}

function parseBlocks(content: string): ParsedBlock[] {
  const key = hashContent(content);
  const cached = tokenCache.get(key);
  if (cached) {
    // MRU promotion: delete and re-insert to maintain insertion order
    tokenCache.delete(key);
    tokenCache.set(key, cached);
    return cached;
  }

  // Fast path: no markdown syntax
  if (!MD_SYNTAX_RE.test(content.slice(0, 500))) {
    const result: ParsedBlock[] = [{ type: "text", content, raw: content }];
    cacheResult(key, result);
    return result;
  }

  const blocks: ParsedBlock[] = [];
  const lines = content.split("\n");
  let i = 0;
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = "";
  let blockStart = i;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith("```")) {
      if (inCodeBlock) {
        const raw = lines.slice(blockStart, i + 1).join("\n");
        blocks.push({ type: "codeblock", content: codeLines.join("\n"), language: codeLang, raw });
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
        blockStart = i;
      }
      i++;
      continue;
    }

    if (inCodeBlock) { codeLines.push(line); i++; continue; }

    if (/^[-*_]{3,}\s*$/.test(line)) {
      blocks.push({ type: "hr", content: "", raw: line });
      i++; continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: "heading", content: headingMatch[2]!, level: headingMatch[1]!.length, raw: line });
      i++; continue;
    }

    if (line.startsWith("> ")) {
      blocks.push({ type: "blockquote", content: line.slice(2), raw: line });
      i++; continue;
    }

    if (/^[\s]*[-*+]\s/.test(line)) {
      blocks.push({ type: "bullet", content: line.replace(/^[\s]*[-*+]\s/, ""), raw: line });
      i++; continue;
    }

    if (/^[\s]*\d+\.\s/.test(line)) {
      blocks.push({ type: "bullet", content: line.replace(/^[\s]*\d+\.\s/, ""), raw: line });
      i++; continue;
    }

    blocks.push({ type: "text", content: line, raw: line });
    i++;
  }

  if (inCodeBlock && codeLines.length > 0) {
    const raw = lines.slice(blockStart).join("\n");
    blocks.push({ type: "codeblock", content: codeLines.join("\n"), language: codeLang, raw });
  }

  cacheResult(key, blocks);
  return blocks;
}

function cacheResult(key: string, blocks: ParsedBlock[]): void {
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const firstKey = tokenCache.keys().next().value;
    if (firstKey) tokenCache.delete(firstKey);
  }
  tokenCache.set(key, blocks);
}

/** Push plain text into the parts list, splitting on color hits so
 *  signed deltas, win-rate values, drawdowns, and ranges within those
 *  contexts render in green/red. Plain segments stay as raw <Text>. */
function pushPlain(parts: React.ReactNode[], keyStart: number, text: string): number {
  let key = keyStart;
  const hits = findColorHits(text);
  if (hits.length === 0) {
    parts.push(<Text key={key++}>{text}</Text>);
    return key;
  }
  let last = 0;
  for (const h of hits) {
    if (h.start > last) parts.push(<Text key={key++}>{text.slice(last, h.start)}</Text>);
    parts.push(<Text key={key++} color={h.color}>{text.slice(h.start, h.end)}</Text>);
    last = h.end;
  }
  if (last < text.length) parts.push(<Text key={key++}>{text.slice(last)}</Text>);
  return key;
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    if (boldMatch && boldMatch.index != null) {
      if (boldMatch.index > 0) key = pushPlain(parts, key, remaining.slice(0, boldMatch.index));
      parts.push(<Text key={key++} bold>{boldMatch[1]}</Text>);
      remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
      continue;
    }

    // URL detection — wrap with TerminalLink for OSC 8 clickable hyperlinks
    const urlMatch = remaining.match(/https?:\/\/[^\s<>"')]+/);
    if (urlMatch && urlMatch.index != null) {
      if (urlMatch.index > 0) key = pushPlain(parts, key, remaining.slice(0, urlMatch.index));
      parts.push(<TerminalLink key={key++} url={urlMatch[0]} color={PALETTE.platinum}>{urlMatch[0]}</TerminalLink>);
      remaining = remaining.slice(urlMatch.index + urlMatch[0].length);
      continue;
    }

    const codeMatch = remaining.match(/`([^`]+)`/);
    if (codeMatch && codeMatch.index != null) {
      if (codeMatch.index > 0) key = pushPlain(parts, key, remaining.slice(0, codeMatch.index));
      // Tan for function / strategy / parameter IDs — distinct from the
      // amber used by table headers / H2 so backticked names don't blend
      // with section emphasis. Matches MarkdownRenderer codespan.
      parts.push(<Text key={key++} color={PALETTE.tan}>{codeMatch[1]}</Text>);
      remaining = remaining.slice(codeMatch.index + codeMatch[0].length);
      continue;
    }

    key = pushPlain(parts, key, remaining);
    break;
  }

  return <>{parts}</>;
}

export function StreamingMarkdown({ content, isStreaming }: Props) {
  // Claude Code pattern: stable prefix tracking
  // Only re-parse the tail block, not full content. O(tail) not O(all).
  const stablePrefixRef = useRef("");

  const stripped = stripPromptXMLTags(content);

  // Reset if content was replaced (not appended)
  if (!stripped.startsWith(stablePrefixRef.current)) {
    stablePrefixRef.current = "";
  }

  const boundary = stablePrefixRef.current.length;

  // Parse only from boundary forward
  const tailContent = stripped.substring(boundary);
  const tailBlocks = useMemo(() => parseBlocks(tailContent), [tailContent]);

  // Find last non-empty block — everything before it is stable
  let lastContentIdx = tailBlocks.length - 1;
  while (lastContentIdx >= 0 && !tailBlocks[lastContentIdx]!.content.trim()) {
    lastContentIdx--;
  }

  // Advance stable prefix to include all completed blocks
  let advance = 0;
  for (let i = 0; i < lastContentIdx; i++) {
    advance += tailBlocks[i]!.raw.length + 1; // +1 for newline
  }
  if (advance > 0 && !isStreaming) {
    stablePrefixRef.current = stripped.substring(0, boundary + advance);
  }

  // Stable prefix blocks (memoized, never re-parsed)
  const stableBlocks = useMemo(
    () => stablePrefixRef.current ? parseBlocks(stablePrefixRef.current) : [],
    [stablePrefixRef.current],
  );

  const allBlocks = [...stableBlocks, ...tailBlocks];

  return (
    <Box flexDirection="column">
      {allBlocks.map((block, i) => {
        switch (block.type) {
          case "heading":
            // Bloomberg/Wall-Street palette via shared markdownPalette.
            // Mirrors MarkdownRenderer so streaming and completed paths
            // render identically.
            return (
              <Text key={i} bold color={headingColor(block.level ?? 1)} underline={block.level === 1}>
                {block.content}
              </Text>
            );
          case "codeblock":
            // Delegate to CodeBlock for cli-highlight-powered syntax rendering
            return <CodeBlock key={i} code={block.content} language={block.language} />;
          case "blockquote":
            return (
              <Box key={i} paddingLeft={2}>
                <Text dimColor italic>{"\u2502"} {block.content}</Text>
              </Box>
            );
          case "bullet":
            return (
              <Box key={i} paddingLeft={2}>
                <Text dimColor>{"\u2022"} </Text>
                {renderInline(block.content)}
              </Box>
            );
          case "hr":
            return <Text key={i} dimColor>{"\u2500".repeat(40)}</Text>;
          case "text":
          default:
            if (!block.content.trim()) return null;
            return <Box key={i}>{renderInline(block.content)}</Box>;
        }
      })}
    </Box>
  );
}
