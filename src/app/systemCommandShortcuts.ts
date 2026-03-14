export type SystemShortcutAction = "arm" | "disarm" | "status";

interface PhrasePattern {
  action: SystemShortcutAction;
  tokens: string[];
}

const SYSTEM_SHORTCUT_PATTERNS: PhrasePattern[] = [
  { action: "arm", tokens: ["arm"] },
  { action: "arm", tokens: ["arm", "trading"] },
  { action: "arm", tokens: ["arm", "the", "system"] },
  { action: "arm", tokens: ["enable", "trading"] },
  { action: "disarm", tokens: ["disarm"] },
  { action: "disarm", tokens: ["disarm", "the", "system"] },
  { action: "disarm", tokens: ["disable", "trading"] },
  { action: "status", tokens: ["status"] },
  { action: "status", tokens: ["system", "status"] },
  { action: "status", tokens: ["is", "the", "system", "armed"] },
  { action: "status", tokens: ["is", "system", "armed"] },
  { action: "status", tokens: ["is", "gordon", "armed"] },
  { action: "status", tokens: ["am", "i", "armed"] },
  { action: "status", tokens: ["what", "is", "the", "system", "status"] },
  { action: "status", tokens: ["what", "is", "system", "status"] },
];

function normalizeShortcutTokens(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[?!.,:;]+/g, " ")
    .replace(/\\/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function matchesRepeatedPhrase(tokens: string[], phraseTokens: string[]): boolean {
  if (tokens.length === 0 || phraseTokens.length === 0 || tokens.length % phraseTokens.length !== 0) {
    return false;
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] !== phraseTokens[index % phraseTokens.length]) {
      return false;
    }
  }

  return true;
}

/**
 * Parses plain-text system control prompts after slash-command parsing has already failed.
 * This keeps slash commands as the single mutating command path while still allowing
 * deterministic status reads and explicit guidance for reserved control words.
 */
export function parseSystemShortcut(input: string): SystemShortcutAction | null {
  const tokens = normalizeShortcutTokens(input);

  for (const pattern of SYSTEM_SHORTCUT_PATTERNS) {
    if (matchesRepeatedPhrase(tokens, pattern.tokens)) {
      return pattern.action;
    }
  }

  return null;
}
