import React from "react";
import { Box, Text } from "../ink-custom";
import { marked, type Tokens, type Token } from "marked";
import { CodeBlock } from "./CodeBlock.js";
import { InlineTable } from "./InlineTable.js";

/**
 * MarkdownRenderer — CommonMark + GFM via marked, rendered to Ink.
 *
 * Previously used a custom line-based parser. Replaced with marked.lexer()
 * for full CommonMark + GFM coverage (reference links, nested emphasis,
 * autolinks, escaped chars, strikethrough, task lists, etc.) without us
 * reimplementing each edge case.
 *
 * Kept from the custom implementation:
 *   - Module-level LRU cache (500 entries) keyed by content hash with
 *     MRU promotion. Survives React unmount/remount.
 *   - Fast-path plain-text detection: content with no markdown syntax
 *     in the first 500 chars skips marked.lexer entirely.
 *   - Wraps tables in InlineTable (Unicode box drawing, alignment,
 *     vertical fallback) — marked only tokenizes, we render.
 *   - OSC 8 hyperlinks for links and autolinks.
 */

interface Props {
  content: string;
}

// ============================================================================
// LRU cache for tokenized content
// ============================================================================

const _tokenCache = new Map<string, Token[]>();
const _TOKEN_CACHE_MAX = 500;

// Fast-path regex — if the first 500 chars contain none of these, skip
// marked entirely and emit a single paragraph token. Box-drawing corners
// are included so ASCII-box content doesn't bypass detection.
const MD_SYNTAX_RE = /[#*`|\[\]>~_\\┌└╔╚╭╰]|\n\n|^\d+\. |\n\d+\. |---|___|\*\*\*/;

// ASCII-box detection: LLMs emit visual boxes drawn with Unicode
// box-drawing characters (often lopsided — top + side bars + bottom, no
// right border). We split them out of the content stream BEFORE marked
// sees them, so each box renders as a real Ink <Box borderStyle> that
// spans available width, and the surrounding markdown still parses
// normally.
const ASCII_BOX_TOP = /^\s*[┌╔╭][─━═-]/;
const ASCII_BOX_BOTTOM = /^\s*[└╚╰][─━═-]/;
// Inner-line side bars. Strip BOTH a leading `│ ` AND a trailing ` │` so
// double-bordered boxes (LLMs sometimes emit symmetric borders on every
// content line) don't bleed the right glyph into the rendered text.
const ASCII_BOX_SIDE_LEAD = /^\s*[│║|]\s?/;
const ASCII_BOX_SIDE_TRAIL = /\s*[│║|]\s*$/;

function stripBoxSide(line: string): string {
  return line.replace(ASCII_BOX_SIDE_LEAD, "").replace(ASCII_BOX_SIDE_TRAIL, "");
}

/**
 * Parse a single line of text into marked's inline tokens (bold, italic,
 * code, link, etc.) so box content keeps its formatting. We run marked's
 * block lexer on a one-line string; if the first token is a paragraph,
 * its `.tokens` array IS the inline tokens. Falls back to a bare text
 * token if the line resists tokenization.
 */
function lineToInlineTokens(line: string): Token[] {
  if (!line.trim()) return [{ type: "text", text: " ", raw: " " } as Tokens.Text];
  try {
    const tokens = marked.lexer(line, { gfm: true });
    const first = tokens[0];
    if (first && first.type === "paragraph") {
      return (first as Tokens.Paragraph).tokens ?? [];
    }
  } catch {
    // fall through
  }
  return [{ type: "text", text: line, raw: line } as Tokens.Text];
}

type Segment =
  | { kind: "markdown"; content: string }
  | { kind: "box"; lines: string[] };

function splitAsciiBoxes(content: string): Segment[] {
  const lines = content.split("\n");
  const segments: Segment[] = [];
  let buffer: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (ASCII_BOX_TOP.test(line)) {
      // Look ahead for matching bottom
      let end = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (ASCII_BOX_BOTTOM.test(lines[j]!)) {
          end = j;
          break;
        }
      }
      if (end > i) {
        // Flush text buffer
        if (buffer.length > 0) {
          segments.push({ kind: "markdown", content: buffer.join("\n") });
          buffer = [];
        }
        // Strip side-bars from inner lines (both leading and trailing)
        const inner = lines.slice(i + 1, end).map(stripBoxSide);
        segments.push({ kind: "box", lines: inner });
        i = end + 1;
        continue;
      }
    }
    buffer.push(line);
    i++;
  }
  if (buffer.length > 0) {
    segments.push({ kind: "markdown", content: buffer.join("\n") });
  }
  return segments;
}

function hashContent(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0;
  }
  return `${h}:${content.length}`;
}

function tokenize(content: string): Token[] {
  const key = hashContent(content);
  const cached = _tokenCache.get(key);
  if (cached) {
    // MRU promotion
    _tokenCache.delete(key);
    _tokenCache.set(key, cached);
    return cached;
  }

  // Fast-path: no markdown syntax in first 500 chars
  if (!MD_SYNTAX_RE.test(content.slice(0, 500))) {
    const paragraph: Tokens.Paragraph = {
      type: "paragraph",
      raw: content,
      text: content,
      tokens: [{ type: "text", raw: content, text: content } as Tokens.Text],
    };
    const result: Token[] = [paragraph];
    cacheResult(key, result);
    return result;
  }

  // Full marked lexer — CommonMark + GFM
  const tokens = marked.lexer(content, {
    gfm: true, // Tables, task lists, strikethrough, autolinks
  }) as Token[];
  cacheResult(key, tokens);
  return tokens;
}

function cacheResult(key: string, tokens: Token[]): void {
  if (_tokenCache.size >= _TOKEN_CACHE_MAX) {
    const firstKey = _tokenCache.keys().next().value;
    if (firstKey !== undefined) _tokenCache.delete(firstKey);
  }
  _tokenCache.set(key, tokens);
}

// ============================================================================
// Top-level render
// ============================================================================

export function MarkdownRenderer({ content }: Props) {
  // Pre-split ASCII boxes so each one renders as a real Ink Box instead
  // of getting smushed through marked's paragraph tokenizer. The
  // surrounding markdown segments still go through the normal pipeline.
  const segments = splitAsciiBoxes(content);
  return (
    <Box flexDirection="column">
      {segments.map((seg, i) =>
        seg.kind === "box" ? (
          <Box
            key={i}
            flexDirection="column"
            borderStyle="round"
            borderColor="gray"
            paddingX={1}
            marginY={0}
          >
            {seg.lines.map((line, j) => (
              <Text key={j}>
                <InlineTokens tokens={lineToInlineTokens(line)} />
              </Text>
            ))}
          </Box>
        ) : (
          <MarkdownSegment key={i} content={seg.content} />
        ),
      )}
    </Box>
  );
}

function MarkdownSegment({ content }: { content: string }) {
  const tokens = tokenize(content);
  return (
    <>
      {tokens.map((token, i) => (
        <TokenRenderer key={i} token={token} />
      ))}
    </>
  );
}

// ============================================================================
// Token renderer
// ============================================================================

function TokenRenderer({ token }: { token: Token }) {
  switch (token.type) {
    case "space":
      return null;

    case "heading": {
      const t = token as Tokens.Heading;
      const color = t.depth === 1 ? "yellow" : undefined;
      return (
        <Box paddingLeft={2} marginTop={t.depth <= 2 ? 1 : 0}>
          <Text bold color={color}>
            <InlineTokens tokens={t.tokens ?? []} />
          </Text>
        </Box>
      );
    }

    case "code": {
      const t = token as Tokens.Code;
      return <CodeBlock code={t.text} language={t.lang} />;
    }

    case "hr":
      return (
        <Box paddingLeft={2}>
          <Text dimColor>{"\u2500".repeat(40)}</Text>
        </Box>
      );

    case "blockquote": {
      const t = token as Tokens.Blockquote;
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {(t.tokens ?? []).map((child, i) => (
            <Box key={i}>
              <Text dimColor>{"\u2502"} </Text>
              <Box flexDirection="column" flexGrow={1}>
                <TokenRenderer token={child} />
              </Box>
            </Box>
          ))}
        </Box>
      );
    }

    case "list": {
      const t = token as Tokens.List;
      return <ListRenderer token={t} level={0} />;
    }

    case "paragraph": {
      const t = token as Tokens.Paragraph;
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text>
            <InlineTokens tokens={t.tokens ?? []} />
          </Text>
        </Box>
      );
    }

    case "table": {
      // marked parses tables into { header, align, rows } — convert back
      // to pipe-separated lines and delegate to InlineTable for the
      // Unicode box border rendering we already built.
      //
      // Use tokensToAnsiText (not raw text) so inline markdown like
      // `code` and **bold** become ANSI escape sequences embedded in the
      // cell strings. The width cache strips ANSI before measuring, so
      // alignment math stays correct, and Ink's <Text> passes the codes
      // through to the terminal — bringing back per-word color inside
      // tables (cyan for `tool_name`, bold for **emphasis**).
      const t = token as Tokens.Table;
      const lines: string[] = [];
      // Header: plain text only — InlineTable wraps the whole header line
      // in bold+cyan, and embedded ANSI resets inside would terminate that
      // wrapper mid-cell. Data rows: ANSI-formatted so codespans/bold/em
      // keep their per-word color.
      lines.push("| " + t.header.map((h: Tokens.TableCell) => tokensToPlainText(h.tokens ?? [])).join(" | ") + " |");
      lines.push("| " + t.align.map((a: string | null) => alignMarker(a)).join(" | ") + " |");
      for (const row of t.rows) {
        lines.push("| " + row.map((cell: Tokens.TableCell) => tokensToAnsiText(cell.tokens ?? [])).join(" | ") + " |");
      }
      return <InlineTable lines={lines} />;
    }

    case "html":
      // Strip HTML blocks silently — Ink can't render them
      return null;

    case "text": {
      // Top-level text token (rare — usually inside paragraph)
      const t = token as Tokens.Text;
      return (
        <Box paddingLeft={2}>
          <Text>{t.text}</Text>
        </Box>
      );
    }

    default:
      // Unknown token type (could be a GFM extension or custom token).
      // Fall back to rendering the raw text so content isn't lost.
      return (
        <Box paddingLeft={2}>
          <Text>{(token as Token & { raw?: string }).raw ?? ""}</Text>
        </Box>
      );
  }
}

function alignMarker(a: string | null): string {
  if (a === "left") return ":---";
  if (a === "center") return ":---:";
  if (a === "right") return "---:";
  return "---";
}

// ANSI escape sequences for inline formatting inside table cells.
// Kept minimal so generated strings stay greppable and the width cache's
// ANSI stripper continues to recognize them.
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_ITALIC = "\x1b[3m";
const ANSI_STRIKE = "\x1b[9m";
const ANSI_CYAN = "\x1b[36m";

// Like tokensToPlainText but emits ANSI escape codes for inline formatting
// so codespans render in cyan and bold text stays bold inside cells.
// The width cache strips ANSI before measuring, so column alignment stays
// correct.
function tokensToAnsiText(tokens: Token[]): string {
  return tokens
    .map((t) => {
      if (t.type === "text") return (t as Tokens.Text).text;
      if (t.type === "codespan") return ANSI_CYAN + (t as Tokens.Codespan).text + ANSI_RESET;
      if (t.type === "strong") return ANSI_BOLD + tokensToAnsiText((t as Tokens.Strong).tokens ?? []) + ANSI_RESET;
      if (t.type === "em") return ANSI_ITALIC + tokensToAnsiText((t as Tokens.Em).tokens ?? []) + ANSI_RESET;
      if (t.type === "del") return ANSI_STRIKE + tokensToAnsiText((t as Tokens.Del).tokens ?? []) + ANSI_RESET;
      if (t.type === "link") {
        const link = t as Tokens.Link;
        return `\x1b]8;;${link.href}\x1b\\${ANSI_CYAN}${link.text}${ANSI_RESET}\x1b]8;;\x1b\\`;
      }
      if (t.type === "br") return " ";
      return (t as Token & { text?: string; raw?: string }).text ?? (t as Token & { raw?: string }).raw ?? "";
    })
    .join("");
}

// Walk a token tree and extract plain text — used for table cells where the
// InlineTable renderer expects raw strings, not Ink elements.
function tokensToPlainText(tokens: Token[]): string {
  return tokens
    .map((t) => {
      if (t.type === "text") return (t as Tokens.Text).text;
      if (t.type === "codespan") return (t as Tokens.Codespan).text;
      if (t.type === "strong") return tokensToPlainText((t as Tokens.Strong).tokens ?? []);
      if (t.type === "em") return tokensToPlainText((t as Tokens.Em).tokens ?? []);
      if (t.type === "del") return tokensToPlainText((t as Tokens.Del).tokens ?? []);
      if (t.type === "br") return " ";
      return (t as Token & { text?: string; raw?: string }).text ?? (t as Token & { raw?: string }).raw ?? "";
    })
    .join("");
}

// ============================================================================
// List renderer with nested support + task lists
// ============================================================================

function ListRenderer({ token, level }: { token: Tokens.List; level: number }) {
  const indent = "  ".repeat(level);
  return (
    <Box flexDirection="column" paddingLeft={level === 0 ? 2 : 0}>
      {token.items.map((item: Tokens.ListItem, i: number) => {
        const bullet = token.ordered
          ? `${Number(token.start ?? 1) + i}.`
          : level === 0
            ? "\u2022"
            : level === 1
              ? "\u25E6"
              : "\u25AB";
        const task = item.task
          ? item.checked
            ? "\u2611 "
            : "\u2610 "
          : "";

        // Each item can have multiple child tokens (paragraph + nested list etc.)
        const childTokens = item.tokens ?? [];
        const firstParagraph = childTokens.find((t) => t.type === "paragraph" || t.type === "text");
        const nestedLists = childTokens.filter((t): t is Tokens.List => t.type === "list");

        return (
          <Box key={i} flexDirection="column">
            <Box>
              <Text>
                {indent}{"  "}{bullet} {task}
                {firstParagraph && (firstParagraph.type === "paragraph" || firstParagraph.type === "text") ? (
                  <InlineTokens
                    tokens={
                      "tokens" in firstParagraph && firstParagraph.tokens
                        ? firstParagraph.tokens
                        : [{ type: "text", text: (firstParagraph as Tokens.Text).text, raw: "" } as Tokens.Text]
                    }
                  />
                ) : null}
              </Text>
            </Box>
            {nestedLists.map((nested, j) => (
              <ListRenderer key={`nested-${j}`} token={nested} level={level + 1} />
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

// ============================================================================
// Inline token rendering
// ============================================================================

function InlineTokens({ tokens }: { tokens: Token[] }): React.ReactElement {
  return (
    <>
      {tokens.map((token, i) => (
        <InlineToken key={i} token={token} />
      ))}
    </>
  );
}

function InlineToken({ token }: { token: Token }): React.ReactElement | null {
  switch (token.type) {
    case "text": {
      const t = token as Tokens.Text;
      // Sub-tokens for inline elements inside text (escaped chars etc.)
      if (t.tokens && t.tokens.length > 0) {
        return <InlineTokens tokens={t.tokens} />;
      }
      return <Text>{t.text}</Text>;
    }

    case "strong": {
      const t = token as Tokens.Strong;
      return (
        <Text bold>
          <InlineTokens tokens={t.tokens ?? [{ type: "text", text: t.text, raw: "" } as Tokens.Text]} />
        </Text>
      );
    }

    case "em": {
      const t = token as Tokens.Em;
      return (
        <Text italic>
          <InlineTokens tokens={t.tokens ?? [{ type: "text", text: t.text, raw: "" } as Tokens.Text]} />
        </Text>
      );
    }

    case "del": {
      // GFM strikethrough
      const t = token as Tokens.Del;
      return (
        <Text strikethrough>
          <InlineTokens tokens={t.tokens ?? [{ type: "text", text: t.text, raw: "" } as Tokens.Text]} />
        </Text>
      );
    }

    case "codespan": {
      // Cyan matches StreamingMarkdown so backtick-wrapped tool/function
      // names (`run_backtest`, `strategy_iterate`, etc.) keep their accent
      // color across both streaming and completed render paths.
      const t = token as Tokens.Codespan;
      return <Text color="cyan">{t.text}</Text>;
    }

    case "link": {
      const t = token as Tokens.Link;
      // OSC 8 hyperlink — modern terminals render as clickable
      const displayText = t.text;
      const wrapped = `\u001b]8;;${t.href}\u001b\\${displayText}\u001b]8;;\u001b\\`;
      return <Text color="cyan">{wrapped}</Text>;
    }

    case "image": {
      const t = token as Tokens.Image;
      const alt = t.text || t.href.split("/").pop() || "image";
      return (
        <Text dimColor italic>
          [image: {alt}]
        </Text>
      );
    }

    case "br":
      return <Text>{"\n"}</Text>;

    case "html": {
      // Strip inline HTML silently
      return null;
    }

    case "escape": {
      const t = token as Tokens.Escape;
      return <Text>{t.text}</Text>;
    }

    default:
      return <Text>{(token as Token & { raw?: string }).raw ?? ""}</Text>;
  }
}
