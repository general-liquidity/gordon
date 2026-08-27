import { Text, type TextProps } from "../ink-custom";

// ============================================================================
// Link — OSC-8 clickable terminal hyperlink
//
// Emits the OSC-8 sequence  \x1b]8;;URL\x1b\  text  \x1b]8;;\x1b\
// (ST-terminated form) when the host terminal is known to render hyperlinks.
// Otherwise it degrades to plain text, optionally trailing a dimmed raw URL.
//
// Works on the shipping ink@6 path — it is a thin composition over Text and
// carries no dependency on the custom renderer / hyperlinkPool.
// ============================================================================

type Env = Record<string, string | undefined>;

const ST = "\x1b\\"; // String Terminator (ESC \)

/**
 * Whether the terminal is known to support OSC-8 hyperlinks.
 * Env-driven so it stays deterministic and unit-testable.
 */
export function supportsHyperlinks(env: Env = process.env): boolean {
  if (env.NO_COLOR) return false;
  if (env.TERM === "dumb") return false;
  if (env.FORCE_HYPERLINK === "1" || env.FORCE_HYPERLINK === "true") return true;

  const term = env.TERM ?? "";
  const program = env.TERM_PROGRAM ?? "";

  if (env.WT_SESSION) return true; // Windows Terminal
  if (env.VTE_VERSION) return true; // GNOME Terminal / Konsole (VTE >= 0.50)
  if (/iTerm|WezTerm|ghostty|Hyper/i.test(program)) return true;
  if (/kitty|wezterm|ghostty/i.test(term)) return true;
  if (env.KITTY_WINDOW_ID) return true;

  return false;
}

/** Wrap `text` in an OSC-8 hyperlink pointing at `url`. */
export function osc8Link(url: string, text: string): string {
  return `\x1b]8;;${url}${ST}${text}\x1b]8;;${ST}`;
}

/**
 * The rendered string for a link: OSC-8 when supported, otherwise plain text.
 * Exposed for tests + non-React callers.
 */
export function linkString(url: string, text: string, env: Env = process.env): string {
  return supportsHyperlinks(env) ? osc8Link(url, text) : text;
}

interface Props extends Omit<TextProps, "children"> {
  url: string;
  children: string;
  /** When hyperlinks are unsupported, trail a dimmed "(url)" after the text. */
  showUrl?: boolean;
}

export function Link({ url, children, showUrl = false, ...textProps }: Props) {
  if (supportsHyperlinks()) {
    return <Text {...textProps}>{osc8Link(url, children)}</Text>;
  }
  if (showUrl) {
    return (
      <Text>
        <Text {...textProps}>{children}</Text>
        <Text dimColor> ({url})</Text>
      </Text>
    );
  }
  return <Text {...textProps}>{children}</Text>;
}
