/**
 * Markdown Text Renderer
 * Converts markdown syntax to styled Ink Text components
 */

import React from "react";
import { Text, Box } from "ink";
import { COLORS } from "../theme.ts";

interface MarkdownTextProps {
  children: string;
  color?: string;
}

/**
 * Parse and render markdown text with Ink styling
 */
export const MarkdownText: React.FC<MarkdownTextProps> = ({
  children,
  color = COLORS.WHITE,
}) => {
  const lines = children.split("\n");
  const elements: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let inTable = false;
  let tableRows: string[][] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Code block handling
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        // End code block
        elements.push(
          <Box
            key={`code-block-${i}`}
            flexDirection="column"
            borderStyle="single"
            borderColor={COLORS.DIM}
            paddingX={1}
            marginY={1}
          >
            {codeBlockContent.map((codeLine, j) => (
              <Text key={`code-line-${i}-${j}`} color={COLORS.ACCENT}>
                {codeLine}
              </Text>
            ))}
          </Box>
        );
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Table handling
    if (line.includes("|") && line.trim().startsWith("|")) {
      const cells = line
        .split("|")
        .filter((c) => c.trim() !== "")
        .map((c) => c.trim());

      // Skip separator rows (|---|---|)
      if (cells.every((c) => /^[-:]+$/.test(c))) {
        continue;
      }

      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      // End table, render it
      elements.push(renderTable(tableRows, i));
      tableRows = [];
      inTable = false;
    }

    // Headers
    if (line.startsWith("### ")) {
      elements.push(
        <Text key={`h3-${i}`} color={COLORS.ACCENT} bold>
          {line.slice(4)}
        </Text>
      );
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <Text key={`h2-${i}`} color={COLORS.ACCENT} bold>
          {line.slice(3)}
        </Text>
      );
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(
        <Text key={`h1-${i}`} color={COLORS.HIGHLIGHT} bold>
          {line.slice(2)}
        </Text>
      );
      continue;
    }

    // Bullet points
    if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <Box key={`bullet-${i}`}>
          <Text color={COLORS.ACCENT}>  • </Text>
          {renderInlineMarkdown(line.slice(2), color)}
        </Box>
      );
      continue;
    }

    // Numbered lists
    const numberedMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      elements.push(
        <Box key={`num-${i}`}>
          <Text color={COLORS.ACCENT}>  {numberedMatch[1]}. </Text>
          {renderInlineMarkdown(numberedMatch[2] ?? "", color)}
        </Box>
      );
      continue;
    }

    // Empty lines
    if (line.trim() === "") {
      elements.push(<Text key={`empty-${i}`}> </Text>);
      continue;
    }

    // Regular text with inline markdown
    elements.push(
      <Box key={`text-${i}`}>
        {renderInlineMarkdown(line, color)}
      </Box>
    );
  }

  // Handle unclosed table
  if (inTable && tableRows.length > 0) {
    elements.push(renderTable(tableRows, lines.length));
  }

  return <Box flexDirection="column">{elements}</Box>;
};

/**
 * Render inline markdown (bold, italic, code, links)
 * Single-pass regex tokenizer — unmatched * are stripped instead of rendered literally.
 */
function renderInlineMarkdown(text: string, baseColor: string): React.ReactNode {
  // Order matters: bold-italic before bold before italic, code before others
  const TOKEN_RE =
    /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`([^`]+)`|\[([^\]]+)\]\([^)]+\)|(\$[\d,]+\.?\d*)|([+-]?\d+\.?\d*%)/g;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let keyIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(text)) !== null) {
    // Plain text before this match — strip stray * characters
    if (match.index > lastIndex) {
      const plain = text.slice(lastIndex, match.index).replace(/\*/g, "");
      if (plain) parts.push(<Text key={keyIndex++} color={baseColor}>{plain}</Text>);
    }

    if (match[1] !== undefined) {
      // ***bold italic***
      parts.push(<Text key={keyIndex++} bold italic color={baseColor}>{match[1]}</Text>);
    } else if (match[2] !== undefined) {
      // **bold**
      parts.push(<Text key={keyIndex++} bold color={baseColor}>{match[2]}</Text>);
    } else if (match[3] !== undefined) {
      // *italic*
      parts.push(<Text key={keyIndex++} italic color={baseColor}>{match[3]}</Text>);
    } else if (match[4] !== undefined) {
      // _italic_
      parts.push(<Text key={keyIndex++} italic color={baseColor}>{match[4]}</Text>);
    } else if (match[5] !== undefined) {
      // `code`
      parts.push(<Text key={keyIndex++} color={COLORS.ACCENT}>{match[5]}</Text>);
    } else if (match[6] !== undefined) {
      // [link text](url)
      parts.push(<Text key={keyIndex++} color={COLORS.BLUE} underline>{match[6]}</Text>);
    } else if (match[7] !== undefined) {
      // $price
      parts.push(<Text key={keyIndex++} color={COLORS.HIGHLIGHT}>{match[7]}</Text>);
    } else if (match[8] !== undefined) {
      // percentage
      parts.push(
        <Text key={keyIndex++} color={match[8].startsWith("-") ? COLORS.RED : COLORS.GREEN}>
          {match[8]}
        </Text>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last match — strip stray *
  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex).replace(/\*/g, "");
    if (tail) parts.push(<Text key={keyIndex++} color={baseColor}>{tail}</Text>);
  }

  if (parts.length === 0) {
    return <Text color={baseColor}>{text.replace(/\*/g, "")}</Text>;
  }

  return <Text>{parts}</Text>;
}

/**
 * Render a markdown table
 */
function renderTable(rows: string[][], keyPrefix: number): React.ReactNode {
  if (rows.length === 0) return null;

  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);

  // Calculate column widths
  const colWidths = headers.map((h, i) => {
    const maxDataWidth = Math.max(
      ...dataRows.map((row) => (row[i] ?? "").length)
    );
    return Math.max(h.length, maxDataWidth, 6);
  });

  return (
    <Box key={`table-${keyPrefix}`} flexDirection="column" marginY={1}>
      {/* Header */}
      <Box>
        {headers.map((header, i) => (
          <Box key={`th-${keyPrefix}-${i}`} width={colWidths[i]! + 2}>
            <Text color={COLORS.ACCENT} bold>
              {header.padEnd(colWidths[i]!)}
            </Text>
          </Box>
        ))}
      </Box>
      {/* Separator */}
      <Box>
        {colWidths.map((width, i) => (
          <Box key={`sep-${keyPrefix}-${i}`} width={width + 2}>
            <Text color={COLORS.DIM}>{"─".repeat(width)}</Text>
          </Box>
        ))}
      </Box>
      {/* Data rows */}
      {dataRows.map((row, rowIndex) => (
        <Box key={`tr-${keyPrefix}-${rowIndex}`}>
          {row.map((cell, cellIndex) => (
            <Box key={`td-${keyPrefix}-${rowIndex}-${cellIndex}`} width={colWidths[cellIndex]! + 2}>
              {renderInlineMarkdown(cell.padEnd(colWidths[cellIndex]!), COLORS.WHITE)}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

export default MarkdownText;
