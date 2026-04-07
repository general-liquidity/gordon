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
  opus:       { provider: "anthropic", model: "claude-opus-4-6",           displayName: "Claude Opus 4.6" },
  sonnet:     { provider: "anthropic", model: "claude-sonnet-4-6",         displayName: "Claude Sonnet 4.6" },
  haiku:      { provider: "anthropic", model: "claude-haiku-4-5",          displayName: "Claude Haiku 4.5" },
  claude:     { provider: "anthropic", model: "claude-sonnet-4-6",         displayName: "Claude Sonnet 4.6 (default)" },

  // ── OpenAI ──
  "gpt-5.4":      { provider: "openai", model: "gpt-5.4",       displayName: "GPT-5.4 (1.1M ctx, $3/$15)" },
  gpt5:           { provider: "openai", model: "gpt-5.4",       displayName: "GPT-5.4" },
  "gpt-5.4-mini": { provider: "openai", model: "gpt-5.4-mini",  displayName: "GPT-5.4 mini (400K ctx, $0.75/$5)" },
  gpt5mini:       { provider: "openai", model: "gpt-5.4-mini",  displayName: "GPT-5.4 mini" },
  "gpt-5.4-nano": { provider: "openai", model: "gpt-5.4-nano",  displayName: "GPT-5.4 nano (400K ctx, $0.20/$1)" },
  gpt5nano:       { provider: "openai", model: "gpt-5.4-nano",  displayName: "GPT-5.4 nano" },
  "gpt-5.4-pro":  { provider: "openai", model: "gpt-5.4-pro",   displayName: "GPT-5.4 Pro (1.1M ctx)" },
  gpt5pro:        { provider: "openai", model: "gpt-5.4-pro",   displayName: "GPT-5.4 Pro" },
  gpt:            { provider: "openai", model: "gpt-5.4",       displayName: "GPT-5.4 (default)" },

  // ── Google ──
  gemini:             { provider: "google", model: "gemini-3.1-pro-preview",              displayName: "Gemini 3.1 Pro" },
  "gemini-pro":       { provider: "google", model: "gemini-3.1-pro-preview",              displayName: "Gemini 3.1 Pro" },
  "gemini-flash":     { provider: "google", model: "gemini-3.1-flash-lite-preview",       displayName: "Gemini 3.1 Flash Lite" },
  "gemini-tools":     { provider: "google", model: "gemini-3.1-pro-preview-customtools",  displayName: "Gemini 3.1 Pro (custom tools)" },
  "gemma-26b":        { provider: "google", model: "gemma-4-26b-it",                      displayName: "Gemma 4 26B" },
  "gemma-31b":        { provider: "google", model: "gemma-4-31b-it",                      displayName: "Gemma 4 31B" },
  gemma:              { provider: "google", model: "gemma-4-31b-it",                      displayName: "Gemma 4 31B" },

  // ── Inception ──
  mercury:      { provider: "inception", model: "mercury-2",      displayName: "Mercury 2 (128K ctx, $0.25/$0.75)" },
  "mercury-2":  { provider: "inception", model: "mercury-2",      displayName: "Mercury 2" },
  "mercury-edit": { provider: "inception", model: "mercury-edit-2", displayName: "Mercury Edit 2 (code editing)" },

  // ── Dedalus (OpenAI-compatible router) ──
  "dedalus-gpt":    { provider: "dedalus", model: "openai/gpt-5.4",                              displayName: "GPT-5.4 via Dedalus" },
  "dedalus-opus":   { provider: "dedalus", model: "openai/anthropic/claude-opus-4-6",             displayName: "Opus 4.6 via Dedalus" },
  "dedalus-haiku":  { provider: "dedalus", model: "openai/anthropic/claude-haiku-4-5-20251001",   displayName: "Haiku 4.5 via Dedalus" },
  "dedalus-gemini": { provider: "dedalus", model: "openai/google/gemini-3.1-pro-preview",         displayName: "Gemini 3.1 Pro via Dedalus" },
  grok:             { provider: "dedalus", model: "openai/xai/grok-4-1-fast-reasoning",           displayName: "Grok 4.1 Fast Reasoning" },
  "grok-fast":      { provider: "dedalus", model: "openai/xai/grok-4-1-fast-reasoning",           displayName: "Grok 4.1 Fast Reasoning" },
  "grok-nonr":      { provider: "dedalus", model: "openai/xai/grok-4-1-fast-non-reasoning",       displayName: "Grok 4.1 Fast Non-Reasoning" },
  kimi:             { provider: "dedalus", model: "openai/moonshot/kimi-k2.5",                    displayName: "Kimi K2.5" },

  // ── Meta aliases ──
  best:       { provider: "anthropic", model: "claude-opus-4-6",   displayName: "Best (Opus 4.6)" },
  fast:       { provider: "anthropic", model: "claude-haiku-4-5",  displayName: "Fast (Haiku 4.5)" },
  cheap:      { provider: "openai",    model: "gpt-5.4-nano",     displayName: "Cheap (GPT-5.4 nano)" },
  reasoning:  { provider: "openai",    model: "gpt-5.4-pro",      displayName: "Reasoning (GPT-5.4 Pro)" },
  default:    { provider: "openai",    model: "gpt-5.4",          displayName: "Default (GPT-5.4)" },
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
