import React, { useState } from "react";
import { Box, Text, useInput } from "../ink-custom";

/**
 * ThreadBrowser — Searchable thread/session browser
 *
 * Lists sessions with metadata. Search, switch, resume, delete.
 */

interface ThreadInfo {
  id: string;
  name?: string;
  createdAt: string;
  messageCount: number;
  lastActivity: string;
  isActive: boolean;
}

interface Props {
  threads: ThreadInfo[];
  activeThreadId: string | null;
  onSwitch: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  onCancel: () => void;
}

export function ThreadBrowser({ threads, activeThreadId, onSwitch, onDelete, onCancel }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [query, setQuery] = useState("");

  const filtered = query
    ? threads.filter((t) =>
        t.id.toLowerCase().includes(query.toLowerCase()) ||
        (t.name ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : threads;

  useInput((input, key) => {
    if (key.escape) {
      if (query) { setQuery(""); setSelectedIdx(0); }
      else onCancel();
      return;
    }
    if (key.return) {
      const thread = filtered[selectedIdx];
      if (thread && thread.id !== activeThreadId) onSwitch(thread.id);
      return;
    }
    if (key.upArrow) setSelectedIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
    if (key.delete && key.ctrl) {
      const thread = filtered[selectedIdx];
      if (thread && thread.id !== activeThreadId) onDelete(thread.id);
      return;
    }
    if (key.backspace) { setQuery((q) => q.slice(0, -1)); setSelectedIdx(0); return; }
    if (input && !key.ctrl && !key.meta) { setQuery((q) => q + input); setSelectedIdx(0); }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">SESSIONS</Text>
        <Text dimColor>  ({filtered.length} threads)</Text>
      </Box>

      <Box>
        <Text color="cyanBright">{"\uD83D\uDD0D"} </Text>
        {query ? <Text>{query}<Text color="cyanBright">{"\u2588"}</Text></Text> : <Text dimColor>Type to search...</Text>}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {filtered.slice(0, 15).map((thread, i) => {
          const isFocused = i === selectedIdx;
          const isActive = thread.id === activeThreadId;
          const age = timeSince(thread.lastActivity);
          return (
            <Box key={thread.id}>
              <Text color={isFocused ? "cyanBright" : undefined}>
                {isFocused ? " \u25B8" : "  "}
              </Text>
              <Text color={isActive ? "green" : isFocused ? "cyanBright" : undefined} bold={isFocused || isActive}>
                {" "}{(thread.name ?? thread.id.slice(0, 24)).padEnd(26)}
              </Text>
              <Text dimColor={!isFocused}>
                {String(thread.messageCount).padStart(3)} msgs {"\u00B7"} {age}
              </Text>
              {isActive && <Text color="green"> (active)</Text>}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{"\u2191\u2193"} navigate {"\u00B7"} Enter switch {"\u00B7"} Ctrl+Del delete {"\u00B7"} Esc close</Text>
      </Box>
    </Box>
  );
}

function timeSince(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
