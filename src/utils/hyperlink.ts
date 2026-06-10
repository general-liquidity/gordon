/**
 * Terminal Hyperlinks
 * Uses OSC 8 escape sequences for clickable URLs in supported terminals.
 * Falls back to plain text in unsupported environments.
 */

/**
 * Whether the terminal supports OSC 8 hyperlinks.
 * Supported by: iTerm2, Windows Terminal, GNOME Terminal, Konsole, Alacritty, WezTerm.
 * Not supported by: plain xterm, some CI environments, piped output.
 */
function supportsHyperlinks(): boolean {
  if (!process.stdout.isTTY) return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.TERM === "dumb") return false;

  // Known supporting terminals
  if (process.env.WT_SESSION) return true; // Windows Terminal
  if (process.env.TERM_PROGRAM === "iTerm.app") return true;
  if (process.env.TERM_PROGRAM === "WezTerm") return true;
  if (process.env.VTE_VERSION) return true; // GNOME Terminal, Konsole
  if (process.env.TERM_PROGRAM === "Hyper") return true;
  if (process.env.TERM_PROGRAM === "Alacritty") return true;

  // Default: enable for most modern terminals
  return true;
}

/**
 * Create a clickable terminal hyperlink using OSC 8.
 *
 * @param text - The visible text
 * @param url - The URL to link to
 * @returns Formatted string — clickable hyperlink or "text (url)" fallback
 */
export function hyperlink(text: string, url: string): string {
  if (!supportsHyperlinks()) {
    return `${text} (${url})`;
  }
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

/**
 * Create a hyperlink that shows just the URL as both text and link.
 */
export function linkUrl(url: string): string {
  return hyperlink(url, url);
}
