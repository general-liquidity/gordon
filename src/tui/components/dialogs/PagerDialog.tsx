import React, { useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "../../ink-custom";
import type { Message } from "../messages/MessageBubble.tsx";

export const PAGER_LINE_THRESHOLD = 60;

export interface PagerDialogProps {
  title: string;
  content: string;
  onClose: () => void;
}

export function paginate(lines: string[], pageSize: number): { pages: string[][]; pageCount: number } {
  const size = Math.max(1, Math.floor(pageSize));
  if (lines.length === 0) return { pages: [[]], pageCount: 1 };

  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += size) {
    pages.push(lines.slice(i, i + size));
  }
  return { pages, pageCount: pages.length };
}

export function findLastLongMessage(messages: Message[], threshold: number): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    if (message.content.split("\n").length > threshold) return message;
  }
  return null;
}

export function PagerDialog({ title, content, onClose }: PagerDialogProps): React.JSX.Element {
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const columns = stdout?.columns ?? 80;
  const pageSize = Math.max(1, rows - 4);
  const lines = useMemo(() => content.split("\n"), [content]);
  const maxOffset = Math.max(0, lines.length - pageSize);
  const [offset, setOffset] = useState(0);

  const pageCount = Math.max(1, Math.ceil(lines.length / pageSize));
  const pageNumber = Math.min(pageCount, Math.floor(offset / pageSize) + 1);
  const visibleLines = lines.slice(offset, offset + pageSize);
  const bodyWidth = Math.max(20, columns - 4);

  useInput((input, key) => {
    if (key.escape || input === "q") {
      onClose();
      return;
    }
    if (input === " " || key.pageDown || key.rightArrow) {
      setOffset((current) => Math.min(maxOffset, current + pageSize));
      return;
    }
    if (input === "b" || key.pageUp || key.leftArrow) {
      setOffset((current) => Math.max(0, current - pageSize));
      return;
    }
    if (key.downArrow) {
      setOffset((current) => Math.min(maxOffset, current + 1));
      return;
    }
    if (key.upArrow) {
      setOffset((current) => Math.max(0, current - 1));
      return;
    }
    if (input === "g") setOffset(0);
    if (input === "G") setOffset(maxOffset);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyanBright" width={columns}>
      <Text color="cyanBright" bold>{title}</Text>
      <Box flexDirection="column">
        {visibleLines.map((line, index) => (
          <Text key={`${offset}-${index}`}>{clipLine(line, bodyWidth)}</Text>
        ))}
      </Box>
      <Text inverse>
        {` ${title} — Page ${pageNumber}/${pageCount} · space next · b back · g/G top/end · q close `}
      </Text>
    </Box>
  );
}

function clipLine(line: string, width: number): string {
  if (line.length <= width) return line;
  return line.slice(0, width);
}
