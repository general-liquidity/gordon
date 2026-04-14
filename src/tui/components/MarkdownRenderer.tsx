import React from "react";
import { Box, Text } from "ink";
import { CodeBlock } from "./CodeBlock.js";
import { InlineTable } from "./InlineTable.js";

/**
 * MarkdownRenderer -- Parse and render markdown content
 * Phase 15: Headers (bold), bold (**), italic (*), lists (bullet), code blocks (dimmed),
 *           links, blockquotes (dimmed), pipe tables (InlineTable)
 */

interface Props {
  content: string;
}

interface ParsedBlock {
  type: "paragraph" | "heading" | "code" | "table" | "blockquote" | "list" | "hr";
  lines: string[];
  language?: string;
  level?: number;
}

export function MarkdownRenderer({ content }: Props) {
  const blocks = parseBlocks(content);

  return (
    <Box flexDirection="column">
      {blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} />
      ))}
    </Box>
  );
}

// ============================================================================
// Block-level parsing
// ============================================================================

// Token cache — 500 LRU with MRU promotion (Claude Code pattern)
// Lives at module scope so it survives component unmount/remount during
// virtual scroll. Cache key is a proper polynomial rolling hash — the
// previous key (length:slice(0,80):slice(-20)) collided on any two messages
// with similar head/tail, causing frequent re-parses.
const _blockCache = new Map<string, ParsedBlock[]>();
const _BLOCK_CACHE_MAX = 500;

// Fast regex to detect any markdown syntax in the first 500 chars —
// if there's no match, skip the full parser and emit a single paragraph.
// Covers: headings, bold, italic, code, pipe tables, blockquotes, lists,
// links, HR. Matches the Claude Code detection pattern.
const MD_SYNTAX_RE = /[#*`|\[\]>~_\-]|\n\n|^\d+\. |\n\d+\. /;

function hashContent(content: string): string {
  // Polynomial rolling hash — same pattern as StreamingMarkdown.
  // 32-bit hash + length suffix for collision resistance.
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0;
  }
  return `${h}:${content.length}`;
}

function parseBlocks(content: string): ParsedBlock[] {
  const key = hashContent(content);
  const cached = _blockCache.get(key);
  if (cached) {
    // MRU promotion — delete and re-insert so recently used entries
    // bubble to the tail and fresh entries evict from the head.
    _blockCache.delete(key);
    _blockCache.set(key, cached);
    return cached;
  }

  // Fast-path: if the first 500 chars have no markdown syntax at all,
  // emit a single paragraph block without the full parser. Saves ~3ms
  // per plain-text render and covers ~95% of streaming content.
  if (!MD_SYNTAX_RE.test(content.slice(0, 500))) {
    const lines = content.split("\n");
    const result: ParsedBlock[] = [];
    // Collect contiguous non-empty lines as paragraphs
    let current: string[] = [];
    for (const line of lines) {
      if (line.trim() === "") {
        if (current.length > 0) {
          result.push({ type: "paragraph", lines: current });
          current = [];
        }
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) {
      result.push({ type: "paragraph", lines: current });
    }
    cacheResult(key, result);
    return result;
  }

  const lines = content.split("\n");
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block
    const codeMatch = line.match(/^```(\w*)$/);
    if (codeMatch) {
      const language = codeMatch[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.match(/^```\s*$/)) {
        codeLines.push(lines[i]!);
        i++;
      }
      blocks.push({ type: "code", lines: codeLines, language });
      i++; // skip closing ```
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({ type: "heading", lines: [headingMatch[2]!], level: headingMatch[1]!.length });
      i++;
      continue;
    }

    // Horizontal rule
    if (line.match(/^\s*[-*_]{3,}\s*$/)) {
      blocks.push({ type: "hr", lines: [] });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ") || line === ">") {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i]!.startsWith("> ") || lines[i] === ">")) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    // Pipe table (at least 3 pipe-separated cells)
    if (line.includes("|") && line.split("|").length >= 3) {
      const tableLines: string[] = [];
      while (
        i < lines.length &&
        lines[i]!.includes("|") &&
        lines[i]!.split("|").length >= 3
      ) {
        tableLines.push(lines[i]!);
        i++;
      }
      blocks.push({ type: "table", lines: tableLines });
      continue;
    }

    // List items (unordered or ordered)
    if (line.match(/^\s*[-*+]\s/) || line.match(/^\s*\d+\.\s/)) {
      const listLines: string[] = [];
      while (
        i < lines.length &&
        (lines[i]!.match(/^\s*[-*+]\s/) || lines[i]!.match(/^\s*\d+\.\s/) || lines[i]!.match(/^\s{2,}/))
      ) {
        listLines.push(lines[i]!);
        i++;
      }
      blocks.push({ type: "list", lines: listLines });
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph: collect contiguous non-empty, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !lines[i]!.match(/^```/) &&
      !lines[i]!.match(/^#{1,6}\s/) &&
      !lines[i]!.match(/^\s*[-*_]{3,}\s*$/) &&
      !lines[i]!.startsWith("> ") &&
      !(lines[i]!.includes("|") && lines[i]!.split("|").length >= 3) &&
      !lines[i]!.match(/^\s*[-*+]\s/) &&
      !lines[i]!.match(/^\s*\d+\.\s/)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", lines: paraLines });
    }
  }

  cacheResult(key, blocks);
  return blocks;
}

function cacheResult(key: string, blocks: ParsedBlock[]): void {
  if (_blockCache.size >= _BLOCK_CACHE_MAX) {
    // Evict least-recently-used (insertion-order head)
    const firstKey = _blockCache.keys().next().value;
    if (firstKey !== undefined) _blockCache.delete(firstKey);
  }
  _blockCache.set(key, blocks);
}

// ============================================================================
// Block renderers
// ============================================================================

function BlockRenderer({ block }: { block: ParsedBlock }) {
  switch (block.type) {
    case "heading":
      return <HeadingBlock text={block.lines[0] ?? ""} level={block.level ?? 1} />;
    case "code":
      return <CodeBlock code={block.lines.join("\n")} language={block.language} />;
    case "table":
      return <InlineTable lines={block.lines} />;
    case "blockquote":
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {block.lines.map((line, i) => (
            <Box key={i}>
              <Text dimColor>{"\u2502"} {line}</Text>
            </Box>
          ))}
        </Box>
      );
    case "list":
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {block.lines.map((line, i) => {
            const ordered = line.match(/^\s*(\d+)\.\s(.+)$/);
            if (ordered) {
              return (
                <Text key={i}>
                  {"  "}{ordered[1]}. <InlineFormatted text={ordered[2]!} />
                </Text>
              );
            }
            const unordered = line.replace(/^\s*[-*+]\s/, "");
            return (
              <Text key={i}>
                {"  "}{"\u2022"} <InlineFormatted text={unordered} />
              </Text>
            );
          })}
        </Box>
      );
    case "hr":
      return (
        <Box paddingLeft={2}>
          <Text dimColor>{"\u2500".repeat(40)}</Text>
        </Box>
      );
    case "paragraph":
    default:
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {block.lines.map((line, i) => (
            <Text key={i}><InlineFormatted text={line} /></Text>
          ))}
        </Box>
      );
  }
}

function HeadingBlock({ text, level }: { text: string; level: number }) {
  const color = level === 1 ? "yellow" : undefined;
  return (
    <Box paddingLeft={2} marginTop={level <= 2 ? 1 : 0}>
      <Text bold color={color}>{text}</Text>
    </Box>
  );
}

// ============================================================================
// Inline formatting — bold, italic, code, links
// ============================================================================

interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  dimColor?: boolean;
}

function InlineFormatted({ text }: { text: string }) {
  const segments = parseInline(text);

  return (
    <>
      {segments.map((seg, i) => (
        <Text
          key={i}
          bold={seg.bold}
          italic={seg.italic}
          dimColor={seg.dimColor || seg.code}
        >
          {seg.text}
        </Text>
      ))}
    </>
  );
}

function parseInline(text: string): Segment[] {
  const segments: Segment[] = [];
  // Regex for inline formatting: **bold**, *italic*, `code`, [text](url)
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      // **bold**
      segments.push({ text: match[2], bold: true });
    } else if (match[4]) {
      // *italic*
      segments.push({ text: match[4], italic: true });
    } else if (match[6]) {
      // `code`
      segments.push({ text: match[6], code: true });
    } else if (match[8] && match[9]) {
      // [text](url)
      segments.push({ text: `${match[8]} (${match[9]})`, dimColor: true });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }

  if (segments.length === 0) {
    segments.push({ text });
  }

  return segments;
}
