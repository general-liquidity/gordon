import React, { useState, useMemo, useRef, useEffect } from "react";
import { Box, Text, useStdout } from "../../ink-custom";
import { clearInkOutput } from "../../utils/inkInstance.ts";
import { useSlashCommandTypeahead, type TypeaheadMatch } from "../../hooks/useSlashCommandTypeahead.js";
import { useInputHistory } from "../../hooks/input/useInputHistory.js";
import { useImagePaste } from "../../hooks/input/useImagePaste.js";
import { useDeclaredCursor } from "../../hooks/useDeclaredCursor.js";
import { graphemeCount, graphemeToCodeUnit } from "../../utils/graphemes.js";
import { TokenWarning } from "../notices/TokenWarning.tsx";
import {
  VimMode,
  INITIAL_VIM_STATE,
  transition as vimTransition,
  replayChange as vimReplayChange,
  createInitialPersistentState,
  type VimState,
  type VimContext,
} from "../../vim/index.js";
import { useTheme } from "../../themes/ThemeProvider.tsx";
import { markInteraction } from "../../diagnostics/performanceMonitor.ts";
import { useRoutedInput, FOCUS_PRIORITY } from "../../input/InputRouterContext.tsx";
import { argumentHintFor } from "../../utils/argumentHint.ts";
import { PromptInputHelpMenu } from "./PromptInputHelpMenu.tsx";
import type { FrecencyMap } from "../../utils/frecency.ts";

// ============================================================================
// PromptInput — Claude Code-style compact slash command picker
//
// Typing "/" shows a compact list of commands like Claude Code does:
//   /command    Description text here
// No aliases clutter. Full descriptions visible. Tight rows.
// Arrow keys scroll, Tab completes, Enter selects.
//
// ----------------------------------------------------------------------------
// CJK Phase 4 — IME preedit (DEFERRED, see research note below)
// ----------------------------------------------------------------------------
// Phases 1–3 delivered grapheme-aware cursor, vim motions, and column-accurate
// rendering for committed CJK / emoji text. Phase 4 was scoped to render the
// IME composing text underlined until the user confirms it with Enter/Space.
//
// Research (Apr 2026) conclusively shows IME preedit is NOT exposed to the
// CLI process on any major platform:
//   - Ink's `useInput` parses raw keypresses (node_modules/ink/build/hooks/
//     use-input.js) with zero composition/preedit awareness.
//   - macOS Terminal.app / iTerm2: the IME candidate window is an OS layer
//     above the terminal; stdin only sees committed code points.
//   - Windows Terminal + ConPTY: IME preedit is rendered by the terminal as
//     an overlay; the TUI process receives nothing until commit. See
//     openai/codex#4870 — Codex CLI has the mirror problem (re-render flicker
//     over the OS IME overlay) and no fix exists because there is no
//     composition-state escape sequence to parse.
//   - WezTerm: pre-edit/on-the-spot IME "isn't working" (wezterm#3411). The
//     `ime_preedit_rendering` option controls WezTerm's own rendering, not
//     a stdin protocol.
//   - No standardized escape sequence for IME preedit exists. OSC 133 is
//     shell integration (FinalTerm prompt markers), unrelated to IME. The
//     Kitty keyboard protocol reports key events only, no composition.
//
// Evaluated fallbacks and rejected both:
//   (A) Rapid-character heuristic. Gordon already uses a 10ms window for
//       paste detection (lastInputTimeRef). A preedit heuristic on top would
//       misclassify fast ASCII typing as composition, adding a ~500ms commit
//       delay and spurious underline styling for 99% of users while giving
//       CJK users a broken experience (characters on macOS arrive already
//       committed — there is no composing state to catch).
//   (B) Escape-sequence parser. No real terminal emits preedit sequences, so
//       a parser would be dead code. OSC 133 is the wrong spec for this.
//
// Gordon's existing grapheme-aware rendering already gives CJK / IME users
// the correct committed-text experience (see PromptDisplay below). Whatever
// the terminal+OS IME do during composition is out of our control; once
// text commits, we render it correctly at 2-column visual width with the
// grapheme-aware cursor.
//
// Revisit if and when a terminal protocol for preedit emerges — likely via
// the Kitty keyboard protocol extension pathway.
// ============================================================================

interface Props {
  onSubmit: (value: string) => void;
  placeholder?: string;
  permissionMode: "auto" | "ask" | "strict" | "paper" | "observe" | "plan";
  activeAgentCount: number;
  activeAgentName: string | null;
  isStreaming: boolean;
  autonomousActive?: boolean;
  autonomousStrategyCount?: number;
  vimMode?: boolean;
  locked?: boolean;
  onShowShortcuts?: () => void;
  /** Stop the in-flight agent turn (Esc while streaming). */
  onStop?: () => void;
  onVimModeChange?: (mode: "insert" | "normal" | "visual") => void;
  effortLevel?: "low" | "medium" | "high" | "auto";
  tokenBudgetRatio?: number;
  /** Command usage stats — folds a frecency signal into typeahead ordering. */
  commandFrecency?: FrecencyMap;
}

// Fixed width for command name column — keeps descriptions aligned
const CMD_COL_WIDTH = 18;

export const PromptInput = React.memo(function PromptInput({
  onSubmit,
  placeholder = "",
  permissionMode,
  activeAgentCount,
  activeAgentName,
  isStreaming,
  autonomousActive = false,
  autonomousStrategyCount = 0,
  vimMode = false,
  locked = false,
  onShowShortcuts,
  onStop,
  onVimModeChange,
  effortLevel,
  tokenBudgetRatio,
  commandFrecency,
}: Props) {
  const { stdout } = useStdout();
  const theme = useTheme();
  const termRows = stdout?.rows ?? 24;
  const termCols = stdout?.columns ?? 80;
  const [value, setValue] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const [vimState, setVimState] = useState<VimState>(INITIAL_VIM_STATE);
  // Persistent vim state that survives across commands and mode switches:
  // the yank register, last find (for ; / ,) and last change (for .). Kept in
  // refs so updates don't trigger re-renders on their own — the buffer/cursor
  // setState calls drive the repaint.
  const vimPersistent = useRef(createInitialPersistentState());
  // Text typed during the current INSERT session, captured for dot-repeat.
  const vimInsertBuffer = useRef("");
  const history = useInputHistory();
  const stashedInputRef = useRef("");
  // The last submitted input — restored to the composer if the user stops the
  // turn with Esc, so they can edit and resend (Claude Code parity).
  const lastSubmittedRef = useRef("");

  // Paste detection: rapid input within 10ms = paste
  const lastInputTimeRef = useRef(0);
  const pasteBufferRef = useRef("");

  // Image paste: swaps pasted image path/clipboard blob for a reference token
  const imagePaste = useImagePaste((imagePath: string) => {
    const id = imagePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "").slice(-8) ?? "img";
    const token = `[image:${id}] `;
    setValue((prev) => prev + token);
    // Image-ref token is ASCII, so grapheme count === code-unit length, but
    // use the helper to keep the invariant explicit.
    setCursorPos((p) => p + graphemeCount(token));
  });

  // Token cost-awareness lives in the footer's CostDisplay (token cost +
  // P&L + trade count). useTokenEstimation hook is still available at
  // src/tui/hooks/useTokenEstimation.ts for callers that want a pre-submit
  // estimate (e.g. slash-command handlers gating expensive operations).

  // Show suggestions when value starts with "/" — allow one space for subcommand browsing
  const slashContent = value.startsWith("/") ? value.slice(1) : "";
  const spaceCount = (slashContent.match(/ /g) ?? []).length;
  const isSlashMode = value === "/" || (value.startsWith("/") && spaceCount <= 1);
  const slashQuery = isSlashMode ? slashContent : "";
  const suggestions = useSlashCommandTypeahead(slashQuery, {
    maxResults: 200,
    showAllOnEmpty: true,
    frecency: commandFrecency,
  });
  const showSuggestions = isSlashMode && suggestions.length > 0;

  // Inline argument-hint ghost text: when the buffer is an exact command match
  // followed by a trailing space (menu closed), render the command's usage
  // arguments as dim ghost text after the cursor.
  const argHint = useMemo(
    () => (showSuggestions ? null : argumentHintFor(value)),
    [value, showSuggestions],
  );

  // Force a clean repaint when the slash menu closes. Vanilla Ink's inline
  // reflow can't fully erase the tall menu frame as it collapses, leaving a
  // stale ghost of the input line; clearing forces Ink to redraw the live
  // region from scratch. Fires only on the open→closed edge, not every render.
  const prevShowSuggestionsRef = useRef(showSuggestions);
  useEffect(() => {
    if (prevShowSuggestionsRef.current && !showSuggestions) {
      clearInkOutput();
    }
    prevShowSuggestionsRef.current = showSuggestions;
  }, [showSuggestions]);

  // Group by workflow for visual sections
  const grouped = useMemo(() => {
    if (!showSuggestions) return [];
    const groups: Array<{
      header: string;
      items: Array<TypeaheadMatch & { globalIdx: number }>;
    }> = [];
    let lastWorkflow = "";
    let globalIdx = 0;

    for (const cmd of suggestions) {
      if (cmd.workflow !== lastWorkflow) {
        groups.push({ header: cmd.workflow, items: [] });
        lastWorkflow = cmd.workflow;
      }
      groups[groups.length - 1]!.items.push({ ...cmd, globalIdx });
      globalIdx++;
    }
    return groups;
  }, [suggestions, showSuggestions]);

  // Show as many suggestions as terminal allows (up to 60% of height).
  // User scrolls with arrow keys — all commands accessible.
  // Cap the menu so the live frame (menu + input + status + composer + a
  // streaming spinner) stays within the terminal — an overflowing inline frame
  // is what vanilla Ink can't cleanly reflow, producing the ghost. Reserve ~14
  // rows for the rest of the bottom chrome.
  const maxVisible = Math.min(
    Math.max(8, Math.floor(termRows * 0.5)),
    30,
    Math.max(6, termRows - 14),
  );

  useRoutedInput((input, key) => {
    if (locked) return;
    markInteraction("keystroke");
    if (value === "" && input === "?" && onShowShortcuts && !key.ctrl && !key.meta) {
      onShowShortcuts();
      return;
    }

    // Vim mode routing — intercept keys when vim is enabled and we're in Normal
    // mode. Enter/Ctrl+C always pass through (REPL convention: Enter submits in
    // any mode). Escape resets the pending command; a literal key drives the
    // NORMAL-mode command parser, which owns the buffer via a VimContext.
    if (vimMode && vimState.mode === VimMode.Normal && !key.return && !key.ctrl) {
      if (key.escape) {
        setVimState({ mode: VimMode.Normal, command: { type: "idle" } });
        return;
      }
      const vimKey = input || "";
      if (!vimKey) return;

      // Mutable draft seeded from live React state. Executors write through the
      // VimContext callbacks; we flush the draft to setState after the parser
      // runs so a single keystroke produces one coherent update.
      const draft: { text: string; cursor: number; mode: VimMode } = {
        text: value,
        cursor: cursorPos,
        mode: VimMode.Normal,
      };
      const ctx: VimContext = {
        get text() { return draft.text; },
        get cursor() { return draft.cursor; },
        setText(t) { draft.text = t; },
        setCursor(c) { draft.cursor = c; },
        enterInsert(c) { draft.cursor = c; draft.mode = VimMode.Insert; vimInsertBuffer.current = ""; },
        getRegister() { return vimPersistent.current.register; },
        setRegister(content, linewise) { vimPersistent.current.register = { content, linewise }; },
        getLastFind() { return vimPersistent.current.lastFind; },
        setLastFind(type, char) { vimPersistent.current.lastFind = { type, char }; },
        recordChange(change) { vimPersistent.current.lastChange = change; },
        onDotRepeat() {
          const last = vimPersistent.current.lastChange;
          if (last) vimReplayChange(last, ctx);
        },
      };

      const result = vimTransition(vimState.command, vimKey, ctx);
      result.execute?.();
      const nextCommand = result.next ?? { type: "idle" };

      if (draft.text !== value) setValue(draft.text);
      const gLen = graphemeCount(draft.text);
      let finalCursor = draft.cursor;
      if (draft.mode === VimMode.Normal && finalCursor >= gLen && gLen > 0) finalCursor = gLen - 1;
      finalCursor = Math.max(0, Math.min(finalCursor, gLen));
      setCursorPos(finalCursor);
      setVimState({ mode: draft.mode, command: draft.mode === VimMode.Insert ? { type: "idle" } : nextCommand });
      if (draft.mode !== vimState.mode) onVimModeChange?.(vimModeName(draft.mode));
      setSelectedIdx(0);
      return;
    }

    // Insert-mode Escape: transition to Normal without clearing the buffer.
    if (vimMode && vimState.mode === VimMode.Insert && key.escape) {
      // Capture the text typed this session for dot-repeat, then reset it.
      if (vimInsertBuffer.current) {
        vimPersistent.current.lastChange = { type: "insert", text: vimInsertBuffer.current };
      }
      vimInsertBuffer.current = "";
      setVimState({ mode: VimMode.Normal, command: { type: "idle" } });
      onVimModeChange?.("normal");
      // Keep cursor inside the buffer in Normal mode (cursor lives on a
      // grapheme, not past end). graphemeCount handles CJK / emoji correctly.
      const gLen = graphemeCount(value);
      if (cursorPos >= gLen && gLen > 0) setCursorPos(gLen - 1);
      return;
    }

    // Shift+Enter: insert newline instead of submitting (newline is 1 grapheme)
    if (key.return && key.shift) {
      setValue((prev) => prev + "\n");
      setCursorPos((p) => p + 1);
      return;
    }

    if (key.return) {
      if (showSuggestions && suggestions[selectedIdx]) {
        const cmd = suggestions[selectedIdx]!;
        history.push(`/${cmd.name}`);
        onSubmit(`/${cmd.name}`);
        setValue("");
        setCursorPos(0);
        setSelectedIdx(0);
      } else {
        const trimmed = value.trim();
        if (trimmed) {
          history.push(trimmed);
          lastSubmittedRef.current = trimmed;
          onSubmit(trimmed);
          setValue("");
          setCursorPos(0);
          setSelectedIdx(0);
        }
      }
      return;
    }

    if (key.escape) {
      // Esc while the agent is streaming → stop the turn and restore the last
      // input for editing. Slash suggestions close first if they're open.
      if (isStreaming && !showSuggestions) {
        onStop?.();
        if (lastSubmittedRef.current) {
          setValue(lastSubmittedRef.current);
          setCursorPos(graphemeCount(lastSubmittedRef.current));
        }
        return;
      }
      setValue("");
      setCursorPos(0);
      setSelectedIdx(0);
      history.reset();
      return;
    }

    // History navigation (up/down when not in slash mode)
    if (!showSuggestions && key.upArrow) {
      if (!history.current) stashedInputRef.current = value;
      const prev = history.goUp();
      if (prev != null) { setValue(prev); setCursorPos(graphemeCount(prev)); }
      return;
    }
    if (!showSuggestions && key.downArrow) {
      const next = history.goDown();
      if (next != null) { setValue(next); setCursorPos(graphemeCount(next)); }
      else {
        setValue(stashedInputRef.current);
        setCursorPos(graphemeCount(stashedInputRef.current));
      }
      return;
    }

    // Cursor movement (left/right) — grapheme-aware. One keystroke = one
    // visible character, even if the char is an emoji or CJK glyph.
    if (key.leftArrow) {
      setCursorPos((p) => Math.max(0, p - 1));
      return;
    }
    if (key.rightArrow) {
      const gLen = graphemeCount(value);
      setCursorPos((p) => Math.min(gLen, p + 1));
      return;
    }

    if (key.backspace || key.delete) {
      setValue((prev) => {
        const gLen = graphemeCount(prev);
        const pos = Math.min(cursorPos, gLen);
        if (pos > 0) {
          setCursorPos(pos - 1);
          // Slice by code units at the grapheme boundaries so we remove the
          // whole cluster (a single emoji / CJK char), not half a surrogate.
          const leftCode = graphemeToCodeUnit(prev, pos - 1);
          const rightCode = graphemeToCodeUnit(prev, pos);
          return prev.slice(0, leftCode) + prev.slice(rightCode);
        }
        return prev;
      });
      setSelectedIdx(0);
      return;
    }

    if (showSuggestions) {
      if (key.upArrow) {
        setSelectedIdx((i) => (i > 0 ? i - 1 : suggestions.length - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIdx((i) => (i < suggestions.length - 1 ? i + 1 : 0));
        return;
      }
      if (key.tab) {
        const selected = suggestions[selectedIdx];
        if (selected) {
          setValue(`/${selected.name} `);
          setSelectedIdx(0);
        }
        return;
      }
    }

    if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow) {
      // Intercept pasted image paths/clipboard images before they land in the buffer
      if (input.length > 4 && imagePaste.handlePastedText(input)) {
        setSelectedIdx(0);
        return;
      }
      const inputGraphemes = graphemeCount(input);
      // Record text typed during a vim INSERT session so `.` can replay it.
      if (vimMode && vimState.mode === VimMode.Insert) vimInsertBuffer.current += input;
      // Always insert at cursor position. Left/right-arrow navigation must
      // produce real edits at the caret, not append-to-end. Slice by code
      // units at the grapheme boundary so we don't split surrogate pairs.
      setValue((prev) => {
        const insertAt = graphemeToCodeUnit(prev, Math.min(cursorPos, graphemeCount(prev)));
        return prev.slice(0, insertAt) + input + prev.slice(insertAt);
      });
      setCursorPos((p) => p + inputGraphemes);
      setSelectedIdx(0);
    }
  }, { id: "prompt-input", priority: FOCUS_PRIORITY.CHAT });

  // Build flat row list with headers interleaved
  const allRows: Array<
    | { kind: "header"; text: string }
    | { kind: "item"; cmd: TypeaheadMatch; globalIdx: number }
  > = [];
  if (showSuggestions) {
    for (const group of grouped) {
      allRows.push({ kind: "header", text: group.header });
      for (const item of group.items) {
        allRows.push({ kind: "item", cmd: item, globalIdx: item.globalIdx });
      }
    }
  }

  // Scroll window centered on selected item
  let selectedRowIdx = 0;
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i]!;
    if (row.kind === "item" && row.globalIdx === selectedIdx) {
      selectedRowIdx = i;
      break;
    }
  }
  const rowScrollStart = Math.max(0, selectedRowIdx - Math.floor(maxVisible / 2));
  const visibleSlice = allRows.slice(rowScrollStart, rowScrollStart + maxVisible);
  const hasMoreAbove = rowScrollStart > 0;
  const hasMoreBelow = rowScrollStart + maxVisible < allRows.length;

  // Description width = terminal width - pointer(3) - "/" - cmd name - padding
  const descWidth = Math.max(20, termCols - 3 - 1 - CMD_COL_WIDTH - 4);

  const isBashMode = value.startsWith("!");
  const isVimNormal = vimMode && vimState.mode === VimMode.Normal;
  const isVimVisual = vimMode && vimState.mode === VimMode.Visual;
  const promptChar = isVimNormal ? "N"
    : isVimVisual ? "V"
    : isBashMode ? "$"
    : isSlashMode ? "/"
    : "\u276F";
  const promptColor = isVimNormal ? "yellow"
    : isVimVisual ? "magenta"
    : "rgb(52,238,176)";

  return (
    <Box flexDirection="column">
      {/* Slash command picker above input — compact like Claude Code */}
      {showSuggestions && (
        <Box flexDirection="column">
          {hasMoreAbove && (
            <Text dimColor> {"\u25B2"} {rowScrollStart} more</Text>
          )}

          {visibleSlice.map((row, i) => {
            if (row.kind === "header") {
              return (
                <Box key={`hdr-${row.text}-${i}`} marginTop={i > 0 ? 1 : 0}>
                  <Text dimColor>
                    {"  ── "}{row.text.toLowerCase()}{" ──"}
                  </Text>
                </Box>
              );
            }

            const { cmd, globalIdx } = row;
            const isFocused = globalIdx === selectedIdx;
            const cmdName = `/${cmd.name}`;
            const padded = cmdName.padEnd(CMD_COL_WIDTH + 1);

            return (
              <Box key={cmd.name}>
                <Text color={isFocused ? "rgb(52,238,176)" : undefined}>
                  {isFocused ? " \u25B8" : "  "}
                </Text>
                <Text color={isFocused ? "rgb(52,238,176)" : undefined} bold={isFocused}>
                  {" "}{padded}
                </Text>
                <Text dimColor={!isFocused} color={isFocused ? "white" : undefined} wrap="truncate-end">
                  {(cmd.description ?? "").slice(0, descWidth)}
                </Text>
              </Box>
            );
          })}

          {hasMoreBelow && (
            <Text dimColor> {"\u25BC"} {allRows.length - rowScrollStart - maxVisible} more</Text>
          )}

          <Text dimColor>
            {" "}{"\u2191\u2193"} select {"\u00B7"} Tab complete {"\u00B7"} Enter run {"\u00B7"} Esc cancel
          </Text>
        </Box>
      )}

      {/* Context-pressure warning rendered above the input line when >= 70% */}
      {typeof tokenBudgetRatio === "number" && tokenBudgetRatio >= 0.7 && (
        <TokenWarning usedTokens={Math.round(tokenBudgetRatio * 100)} maxTokens={100} />
      )}

      {/* Input line. When the buffer is empty and we're not streaming we
          show a placeholder; when streaming we show only the static
          block cursor so the user sees their cursor position even while
          the model is working (Claude Code pattern — cursor never
          disappears once the input is focused). */}
      <Box>
        <Text color={promptColor} bold>{promptChar} </Text>
        <Box flexGrow={1}>
          {value ? (
            <PromptDisplay
              value={value}
              cursorPos={cursorPos}
              isBashMode={isBashMode}
              isSlashMode={isSlashMode}
              isVimNormal={isVimNormal}
              isVimVisual={isVimVisual}
            />
          ) : isStreaming ? (
            <Text color="rgb(52,238,176)">{"█"}</Text>
          ) : (
            <Text color={theme.uiMuted}>{placeholder}</Text>
          )}
          {argHint && (
            <Text>
              <Text color={theme.uiMuted}>{argHint.active}</Text>
              {argHint.rest.length > 0 && (
                <Text dimColor>{" " + argHint.rest.join(" ")}</Text>
              )}
            </Text>
          )}
      </Box>
        {vimMode && (
          <Text
            color={isVimNormal ? theme.riskWarning : isVimVisual ? theme.variantAdvisor : theme.uiMuted}
            bold={isVimNormal || isVimVisual}
          >
            {isVimNormal ? "[VIM NORMAL]" : isVimVisual ? "[VIM VISUAL]" : "[VIM]"}
          </Text>
        )}
        {/* Footer hints moved above input box — status bar handles mode/cost/shortcuts */}
      </Box>

      {/* At-rest keyboard-affordance menu — shown on an empty, focused composer */}
      {value === "" && !isStreaming && !showSuggestions && !locked && (
        <PromptInputHelpMenu />
      )}
    </Box>
  );
});

function vimModeName(mode: VimMode): "insert" | "normal" | "visual" {
  switch (mode) {
    case VimMode.Normal:
      return "normal";
    case VimMode.Visual:
      return "visual";
    case VimMode.Insert:
    default:
      return "insert";
  }
}

// ----------------------------------------------------------------------------
// PromptDisplay — renders the input buffer with a grapheme-aware cursor.
//
// Splits into left / cursor / right segments using code-unit indices derived
// from the grapheme cursor position. The left segment's visual width (CJK/
// emoji counted as 2 columns each) implicitly places the cursor at the right
// terminal column without manual padding: Ink's flex layout flows children
// in order, and each <Text> occupies its natural display width.
// ----------------------------------------------------------------------------
interface PromptDisplayProps {
  value: string;
  cursorPos: number;
  isBashMode: boolean;
  isSlashMode: boolean;
  isVimNormal: boolean;
  isVimVisual: boolean;
}

function PromptDisplay({
  value,
  cursorPos,
  isBashMode,
  isSlashMode,
  isVimNormal,
  isVimVisual,
}: PromptDisplayProps) {
  // Prefix modes (/ and !) strip the leading character from the display and
  // shift the displayed cursor left by one grapheme. The leading char is a
  // single ASCII byte, so grapheme-shift and code-unit-shift coincide.
  const prefixMode = isBashMode || isSlashMode;
  const displayText = prefixMode ? value.slice(1) : value;
  const adjCursor = prefixMode ? Math.max(0, cursorPos - 1) : cursorPos;

  const { leftCodeUnit, rightCodeUnit, charAtCursor } = useDeclaredCursor(
    displayText,
    adjCursor,
  );
  const left = displayText.slice(0, leftCodeUnit);
  const right = displayText.slice(rightCodeUnit);

  const textColor = isBashMode ? "yellow" : isSlashMode ? "rgb(52,238,176)" : undefined;
  const useBlockCursor = !(isVimNormal || isVimVisual);

  // Cursor is rendered statically (no blink). A blink animation forced a
  // full-frame redraw on every tick under vanilla Ink, which made the
  // terminal viewport snap back to the live frame after the user
  // scrolled up to read history. Trade-off: no blink, but stable scroll.
  // The block / inverse styling makes the position obvious without
  // animation.

  return (
    <Text>
      <Text color={textColor}>{left}</Text>
      {useBlockCursor ? (
        <>
          <Text color="rgb(52,238,176)">{"█"}</Text>
          <Text color={textColor}>{right}</Text>
        </>
      ) : (
        <>
          <Text color={textColor} inverse>{charAtCursor}</Text>
          <Text color={textColor}>{right}</Text>
        </>
      )}
    </Text>
  );
}
