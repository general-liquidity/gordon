/**
 * Model Aliases — Short names that resolve to provider + model
 *
 * Claude Code pattern: `/model opus` instantly switches without a picker.
 * Gordon extends this to multiple providers with short memorable aliases.
 *
 * Priority for resolution:
 *   1. Session override (from /model command)
 *   2. CLI flag (--model)
 *   3. GORDON_MODEL env var
 *   4. Config settings
 *   5. Default
 */

export interface ResolvedModel {
  provider: string;
  model: string;
  displayName: string;
}

/**
 * All known aliases. Keys are lowercase.
 */
const ALIASES: Record<string, ResolvedModel> = {
  // ── Anthropic ──
  opus:       { provider: "anthropic", model: "claude-opus-4-6",           displayName: "Claude Opus 4" },
  sonnet:     { provider: "anthropic", model: "claude-sonnet-4-6",         displayName: "Claude Sonnet 4" },
  haiku:      { provider: "anthropic", model: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5" },
  claude:     { provider: "anthropic", model: "claude-sonnet-4-6",         displayName: "Claude Sonnet 4 (default)" },

  // ── OpenAI ──
  gpt4o:      { provider: "openai", model: "gpt-4o",       displayName: "GPT-4o" },
  "gpt-4o":   { provider: "openai", model: "gpt-4o",       displayName: "GPT-4o" },
  gpt4omini:  { provider: "openai", model: "gpt-4o-mini",  displayName: "GPT-4o mini" },
  "gpt-4.1":  { provider: "openai", model: "gpt-4.1",      displayName: "GPT-4.1" },
  o3:         { provider: "openai", model: "o3",            displayName: "o3 (reasoning)" },
  o4mini:     { provider: "openai", model: "o4-mini",       displayName: "o4-mini" },
  "o4-mini":  { provider: "openai", model: "o4-mini",       displayName: "o4-mini" },
  gpt:        { provider: "openai", model: "gpt-4o",        displayName: "GPT-4o (default)" },

  // ── Google ──
  gemini:     { provider: "google", model: "gemini-2.5-pro",   displayName: "Gemini 2.5 Pro" },
  "gemini-pro":   { provider: "google", model: "gemini-2.5-pro",   displayName: "Gemini 2.5 Pro" },
  "gemini-flash": { provider: "google", model: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },

  // ── Inception ──
  mercury:    { provider: "inception", model: "inception/mercury-coder-small-2506", displayName: "Mercury Coder" },
  "mercury-2": { provider: "inception", model: "inception/mercury-2",               displayName: "Mercury 2" },

  // ── Meta aliases ──
  best:       { provider: "anthropic", model: "claude-opus-4-6",   displayName: "Best (Opus 4)" },
  fast:       { provider: "anthropic", model: "claude-haiku-4-5-20251001", displayName: "Fast (Haiku 4.5)" },
  cheap:      { provider: "openai",    model: "gpt-4o-mini",      displayName: "Cheap (GPT-4o mini)" },
  reasoning:  { provider: "openai",    model: "o3",               displayName: "Reasoning (o3)" },
  default:    { provider: "openai",    model: "gpt-4o",           displayName: "Default (GPT-4o)" },
};

/**
 * Resolve a model alias to provider + model. Returns null if not a known alias.
 */
export function resolveAlias(input: string): ResolvedModel | null {
  const normalized = input.trim().toLowerCase();
  return ALIASES[normalized] ?? null;
}

/**
 * Check if a string is a known alias.
 */
export function isAlias(input: string): boolean {
  return input.trim().toLowerCase() in ALIASES;
}

/**
 * Get all known aliases (for help display).
 */
export function getAllAliases(): Array<{ alias: string; resolved: ResolvedModel }> {
  return Object.entries(ALIASES).map(([alias, resolved]) => ({ alias, resolved }));
}

/**
 * Format aliases as a help string.
 */
export function formatAliasHelp(): string {
  const lines: string[] = ["Model aliases (use with /model <alias>):", ""];

  const grouped: Record<string, Array<{ alias: string; resolved: ResolvedModel }>> = {};
  for (const [alias, resolved] of Object.entries(ALIASES)) {
    const provider = resolved.provider;
    if (!grouped[provider]) grouped[provider] = [];
    grouped[provider].push({ alias, resolved });
  }

  for (const [provider, entries] of Object.entries(grouped)) {
    lines.push(`  ${provider}:`);
    // Dedupe by model (some aliases point to same model)
    const seen = new Set<string>();
    for (const { alias, resolved } of entries) {
      if (seen.has(resolved.model)) continue;
      seen.add(resolved.model);
      lines.push(`    ${alias.padEnd(16)} → ${resolved.displayName}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
