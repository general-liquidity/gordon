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
 */
function renderInlineMarkdown(text: string, baseColor: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIndex = 0;

  while (remaining.length > 0) {
    // Bold **text**
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      parts.push(
        <Text key={keyIndex++} bold color={baseColor}>
          {boldMatch[1]}
        </Text>
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic *text* or _text_
    const italicMatch = remaining.match(/^(\*|_)(.+?)\1/);
    if (italicMatch && !remaining.startsWith("**")) {
      parts.push(
        <Text key={keyIndex++} italic color={baseColor}>
          {italicMatch[2]}
        </Text>
      );
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Inline code `text`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <Text key={keyIndex++} color={COLORS.ACCENT}>
          {codeMatch[1]}
        </Text>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Links [text](url) - just show text
    const linkMatch = remaining.match(/^\[([^\]]+)\]\([^)]+\)/);
    if (linkMatch) {
      parts.push(
        <Text key={keyIndex++} color={COLORS.BLUE} underline>
          {linkMatch[1]}
        </Text>
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Price/number highlighting ($1234.56 or +12.5%)
    const priceMatch = remaining.match(/^(\$[\d,]+\.?\d*)/);
    if (priceMatch) {
      parts.push(
        <Text key={keyIndex++} color={COLORS.HIGHLIGHT}>
          {priceMatch[1]}
        </Text>
      );
      remaining = remaining.slice(priceMatch[0].length);
      continue;
    }

    const percentMatch = remaining.match(/^([+-]?\d+\.?\d*%)/);
    if (percentMatch) {
      const isPositive = percentMatch[1]?.startsWith("+") || (!percentMatch[1]?.startsWith("-") && !percentMatch[1]?.startsWith("0"));
      parts.push(
        <Text key={keyIndex++} color={percentMatch[1]?.startsWith("-") ? COLORS.RED : COLORS.GREEN}>
          {percentMatch[1]}
        </Text>
      );
      remaining = remaining.slice(percentMatch[0].length);
      continue;
    }

    // Regular character
    const nextSpecial = remaining.search(/[\*`\[\$]|[+-]?\d+\.?\d*%/);
    if (nextSpecial === -1) {
      // No more special chars
      parts.push(
        <Text key={keyIndex++} color={baseColor}>
          {remaining}
        </Text>
      );
      break;
    } else if (nextSpecial === 0) {
      // Current char is special but didn't match - treat as regular
      parts.push(
        <Text key={keyIndex++} color={baseColor}>
          {remaining[0]}
        </Text>
      );
      remaining = remaining.slice(1);
    } else {
      // Regular text until next special
      parts.push(
        <Text key={keyIndex++} color={baseColor}>
          {remaining.slice(0, nextSpecial)}
        </Text>
      );
      remaining = remaining.slice(nextSpecial);
    }
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
