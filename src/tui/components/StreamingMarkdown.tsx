import React, { useMemo } from "react";
import { Box, Text } from "ink";

// ============================================================================
// StreamingMarkdown — Progressive markdown rendering during streaming
//
// Claude Code pattern: parse markdown as it arrives, render headings, code
// blocks, bold, lists progressively. Fast-path for plain text (no parsing).
// Token cache prevents re-parsing stable prefix on each delta.
// ============================================================================

interface Props {
  content: string;
  isStreaming: boolean;
}

// Fast check: does this content contain markdown syntax?
const MD_SYNTAX_RE = /[#*`|[\]>\-_~]|\n\n|^\d+\. |\n\d+\. /;

// LRU token cache — 500 entries (Claude Code uses 500)
const tokenCache = new Map<string, ParsedToken[]>();
const TOKEN_CACHE_MAX = 500;

interface ParsedToken {
  type: "text" | "bold" | "italic" | "code" | "heading" | "bullet" | "blockquote" | "codeblock" | "hr";
  content: string;
  level?: number;
  language?: string;
}

function cacheKey(content: string): string {
  // Use length + first 80 + last 20 chars — catches both prefix and suffix changes
  return `${content.length}:${content.slice(0, 80)}:${content.slice(-20)}`;
}

function parseTokens(content: string): ParsedToken[] {
  const key = cacheKey(content);
  const cached = tokenCache.get(key);
  if (cached && content.startsWith(key)) return cached;

  // Fast path: no markdown syntax detected
  if (!MD_SYNTAX_RE.test(content.slice(0, 500))) {
    return [{ type: "text", content }];
  }

  const tokens: ParsedToken[] = [];
  const lines = content.split("\n");
  let i = 0;
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = "";

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        tokens.push({ type: "codeblock", content: codeLines.join("\n"), language: codeLang });
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      i++;
      continue;
    }

    // HR
    if (/^[-*_]{3,}\s*$/.test(line)) {
      tokens.push({ type: "hr", content: "" });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      tokens.push({ type: "heading", content: headingMatch[2]!, level: headingMatch[1]!.length });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      tokens.push({ type: "blockquote", content: line.slice(2) });
      i++;
      continue;
    }

    // Bullet list
    if (/^[\s]*[-*+]\s/.test(line)) {
      tokens.push({ type: "bullet", content: line.replace(/^[\s]*[-*+]\s/, "") });
      i++;
      continue;
    }

    // Numbered list
    if (/^[\s]*\d+\.\s/.test(line)) {
      tokens.push({ type: "bullet", content: line.replace(/^[\s]*\d+\.\s/, "") });
      i++;
      continue;
    }

    // Regular text
    tokens.push({ type: "text", content: line });
    i++;
  }

  // Unclosed code block (still streaming)
  if (inCodeBlock && codeLines.length > 0) {
    tokens.push({ type: "codeblock", content: codeLines.join("\n"), language: codeLang });
  }

  // Cache
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const firstKey = tokenCache.keys().next().value;
    if (firstKey) tokenCache.delete(firstKey);
  }
  tokenCache.set(key, tokens);

  return tokens;
}

// Basic syntax highlighting for code blocks (keywords, strings, comments)
function highlightCodeLine(line: string, _language?: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = line;
  let key = 0;

  while (remaining.length > 0) {
    // Comments (// or #)
    const commentMatch = remaining.match(/^(.*?)(\/\/.*|#.*)$/);
    if (commentMatch && commentMatch[2]) {
      if (commentMatch[1]) parts.push(<Text key={key++}>{commentMatch[1]}</Text>);
      parts.push(<Text key={key++} dimColor>{commentMatch[2]}</Text>);
      remaining = "";
      continue;
    }

    // Strings ("..." or '...')
    const stringMatch = remaining.match(/(["'])(?:(?!\1|\\).|\\.)*\1/);
    if (stringMatch && stringMatch.index != null) {
      if (stringMatch.index > 0) parts.push(<Text key={key++}>{remaining.slice(0, stringMatch.index)}</Text>);
      parts.push(<Text key={key++} color="green">{stringMatch[0]}</Text>);
      remaining = remaining.slice(stringMatch.index + stringMatch[0].length);
      continue;
    }

    // Keywords
    const kwMatch = remaining.match(/\b(const|let|var|function|return|if|else|for|while|import|export|from|async|await|class|new|this|true|false|null|undefined|type|interface)\b/);
    if (kwMatch && kwMatch.index != null) {
      if (kwMatch.index > 0) parts.push(<Text key={key++}>{remaining.slice(0, kwMatch.index)}</Text>);
      parts.push(<Text key={key++} color="magenta">{kwMatch[0]}</Text>);
      remaining = remaining.slice(kwMatch.index + kwMatch[0].length);
      continue;
    }

    // Numbers
    const numMatch = remaining.match(/\b\d+\.?\d*\b/);
    if (numMatch && numMatch.index != null) {
      if (numMatch.index > 0) parts.push(<Text key={key++}>{remaining.slice(0, numMatch.index)}</Text>);
      parts.push(<Text key={key++} color="yellow">{numMatch[0]}</Text>);
      remaining = remaining.slice(numMatch.index + numMatch[0].length);
      continue;
    }

    parts.push(<Text key={key++}>{remaining}</Text>);
    break;
  }

  return <>{parts}</>;
}

function renderInlineFormatting(text: string): React.ReactNode {
  // Bold **text**
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    if (boldMatch && boldMatch.index != null) {
      if (boldMatch.index > 0) {
        parts.push(<Text key={key++}>{remaining.slice(0, boldMatch.index)}</Text>);
      }
      parts.push(<Text key={key++} bold>{boldMatch[1]}</Text>);
      remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
      continue;
    }

    // Inline code
    const codeMatch = remaining.match(/`([^`]+)`/);
    if (codeMatch && codeMatch.index != null) {
      if (codeMatch.index > 0) {
        parts.push(<Text key={key++}>{remaining.slice(0, codeMatch.index)}</Text>);
      }
      parts.push(<Text key={key++} color="cyan">{codeMatch[1]}</Text>);
      remaining = remaining.slice(codeMatch.index + codeMatch[0].length);
      continue;
    }

    // No more formatting
    parts.push(<Text key={key++}>{remaining}</Text>);
    break;
  }

  return <>{parts}</>;
}

export function StreamingMarkdown({ content, isStreaming }: Props) {
  const tokens = useMemo(() => parseTokens(content), [content]);

  return (
    <Box flexDirection="column">
      {tokens.map((token, i) => {
        switch (token.type) {
          case "heading":
            return (
              <Text key={i} bold underline={token.level === 1}>
                {token.content}
              </Text>
            );
          case "codeblock":
            return (
              <Box key={i} borderStyle="single" borderColor="gray" paddingX={1} marginY={0} flexDirection="column">
                {token.language && (
                  <Text dimColor bold>{token.language}</Text>
                )}
                {token.content.split("\n").map((line, j) => (
                  <Box key={j}>{highlightCodeLine(line, token.language)}</Box>
                ))}
              </Box>
            );
          case "blockquote":
            return (
              <Box key={i} paddingLeft={2}>
                <Text dimColor italic>{"\u2502"} {token.content}</Text>
              </Box>
            );
          case "bullet":
            return (
              <Box key={i} paddingLeft={2}>
                <Text dimColor>{"\u2022"} </Text>
                {renderInlineFormatting(token.content)}
              </Box>
            );
          case "hr":
            return <Text key={i} dimColor>{"\u2500".repeat(40)}</Text>;
          case "bold":
            return <Text key={i} bold>{token.content}</Text>;
          case "text":
          default:
            if (!token.content.trim()) return null;
            return <Box key={i}>{renderInlineFormatting(token.content)}</Box>;
        }
      })}
      {/* No cursor — Claude Code renders chunks without visible typewriter effect */}
    </Box>
  );
}
