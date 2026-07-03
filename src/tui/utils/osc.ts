// ============================================================================
// Terminal multiplexer OSC passthrough
//
// tmux and GNU screen intercept escape sequences written to their pane and
// only forward the ones they recognize to the outer terminal. Title / tab /
// notification OSC therefore never reach the real terminal unless wrapped in
// the multiplexer's DCS passthrough. Ported from Claude Code's termio/osc.ts
// (wrapForMultiplexer). Detection is env-only — $TMUX / $STY are set by the
// multiplexer itself, never by user config.
// ============================================================================

/**
 * Wrap an OSC/escape sequence for terminal-multiplexer passthrough so it
 * reaches the OUTER terminal. Inside tmux the payload's ESCs are doubled and
 * tunneled through a DCS `ESC P tmux ; <payload> ESC \`; inside screen it's a
 * plain DCS `ESC P <payload> ESC \`. Outside a multiplexer the sequence is
 * returned unchanged.
 *
 * tmux gates this behind `allow-passthrough` (default off in older tmux). When
 * off, tmux silently drops the whole DCS — no junk, no worse than an unwrapped
 * OSC that it would have swallowed anyway.
 *
 * Never pass a bare BEL (\x07) through this: wrapped, tmux never sees the bell
 * and the window-activity flag is lost. Only wrap the OSC itself.
 */
export function wrapForMultiplexer(sequence: string): string {
  if (process.env.TMUX) {
    const escaped = sequence.replaceAll("\x1b", "\x1b\x1b");
    return `\x1bPtmux;${escaped}\x1b\\`;
  }
  if (process.env.STY) {
    return `\x1bP${sequence}\x1b\\`;
  }
  return sequence;
}
