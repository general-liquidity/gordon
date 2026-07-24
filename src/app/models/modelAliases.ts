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
  // ── Anthropic (frontier) ──
  opus:       { provider: "anthropic", model: "claude-opus-4-8",  displayName: "Claude Opus 4.8" },
  sonnet:     { provider: "anthropic", model: "claude-sonnet-5",  displayName: "Claude Sonnet 5" },
  haiku:      { provider: "anthropic", model: "claude-haiku-4-5", displayName: "Claude Haiku 4.5" },
  claude:     { provider: "anthropic", model: "claude-sonnet-5",  displayName: "Claude Sonnet 5 (default)" },
  fable:      { provider: "anthropic", model: "claude-fable-5",   displayName: "Claude Fable 5 (opt-in heavy reasoning)" },

  // ── OpenAI (frontier) ──
  gpt:            { provider: "openai", model: "gpt-5.6",       displayName: "GPT-5.6 (default)" },
  gpt5:           { provider: "openai", model: "gpt-5.6",       displayName: "GPT-5.6" },
  "gpt-5.6":      { provider: "openai", model: "gpt-5.6",       displayName: "GPT-5.6" },
  "gpt-5.5":      { provider: "openai", model: "gpt-5.5",       displayName: "GPT-5.5" },
  "gpt-5.4-mini": { provider: "openai", model: "gpt-5.4-mini",  displayName: "GPT-5.4 mini" },
  gpt5mini:       { provider: "openai", model: "gpt-5.4-mini",  displayName: "GPT-5.4 mini" },
  "gpt-5.4-nano": { provider: "openai", model: "gpt-5.4-nano",  displayName: "GPT-5.4 nano" },
  gpt5nano:       { provider: "openai", model: "gpt-5.4-nano",  displayName: "GPT-5.4 nano" },

  // ── Google (frontier) ──
  gemini:         { provider: "google", model: "gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro" },
  "gemini-pro":   { provider: "google", model: "gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro" },
  "gemini-flash": { provider: "google", model: "gemini-3.6-flash",       displayName: "Gemini 3.6 Flash" },
  "gemini-lite":  { provider: "google", model: "gemini-3.5-flash-lite",  displayName: "Gemini 3.5 Flash Lite" },

  // ── xAI (frontier) ──
  grok:        { provider: "xai", model: "grok-4.5", displayName: "Grok 4.5" },
  "grok-fast": { provider: "xai", model: "grok-4.3", displayName: "Grok 4.3" },

  // ── Frontier labs natively in the Mastra catalogue ──
  // Convenience only — the resolver passes ANY provider/model string through,
  // so operators are not limited to the aliases below.
  deepseek:    { provider: "deepseek",   model: "deepseek-v4-pro",   displayName: "DeepSeek V4 Pro" },
  kimi:        { provider: "moonshotai", model: "kimi-k2.7",         displayName: "Kimi K2.7 (Moonshot)" },
  qwen:        { provider: "alibaba",    model: "qwen3.7-max",       displayName: "Qwen3.7 Max (Alibaba, native)" },
  "qwen-max":  { provider: "alibaba",    model: "qwen3.7-max",       displayName: "Qwen3.7 Max (Alibaba, native)" },
  "qwen-plus": { provider: "alibaba",    model: "qwen3.7-plus",      displayName: "Qwen3.7 Plus (Alibaba, native)" },
  glm:         { provider: "zai",        model: "glm-4.6",           displayName: "GLM-4.6 (z.ai)" },
  zhipu:       { provider: "zhipuai",    model: "glm-4.6",           displayName: "GLM-4.6 (Zhipu)" },
  minimax:     { provider: "minimax",    model: "minimax-m2",        displayName: "MiniMax M2" },
  stepfun:     { provider: "stepfun",    model: "step-3",            displayName: "Step-3 (StepFun)" },
  mistral:     { provider: "mistral",    model: "mistral-large-2512", displayName: "Mistral Large" },

  // ── Routers (pass-through: <router>/<provider>/<model>) ──
  llama:       { provider: "openrouter",   model: "meta-llama/llama-4-maverick", displayName: "Llama 4 Maverick (OpenRouter)" },
  "kimi-or":   { provider: "openrouter",   model: "moonshotai/kimi-k2.7-code",   displayName: "Kimi K2.7 Code (OpenRouter)" },
  together:    { provider: "togetherai",   model: "deepseek-ai/deepseek-v4",     displayName: "DeepSeek V4 (Together)" },
  // Routers lag native providers — Qwen3.7 is not on every gateway yet, so the
  // router alias stays on the widely-mirrored qwen3-max.
  fireworks:   { provider: "fireworks-ai", model: "qwen3-max",                   displayName: "Qwen3 Max (Fireworks)" },

  // ── Local OpenAI-compatible hosts (object form) ──
  "local-qwen":     { provider: "ollama",   model: "qwen3.6",     displayName: "Qwen 3.6 (local via Ollama)" },
  "local-deepseek": { provider: "ollama",   model: "deepseek-v4", displayName: "DeepSeek V4 (local via Ollama)" },
  "local-gemma":    { provider: "ollama",   model: "gemma4:26b",  displayName: "Gemma 4 26B (local via Ollama)" },
  "lmstudio":       { provider: "lmstudio", model: "qwen3.6",     displayName: "Qwen 3.6 (local via LM Studio)" },

  // ── Meta aliases ──
  best:       { provider: "anthropic", model: "claude-opus-4-8",  displayName: "Best (Opus 4.8)" },
  fast:       { provider: "anthropic", model: "claude-haiku-4-5", displayName: "Fast (Haiku 4.5)" },
  cheap:      { provider: "openai",    model: "gpt-5.4-nano",     displayName: "Cheap (GPT-5.4 nano)" },
  reasoning:  { provider: "openai",    model: "gpt-5.6",          displayName: "Reasoning (GPT-5.6)" },
  default:    { provider: "anthropic", model: "claude-sonnet-5",  displayName: "Default (Claude Sonnet 5)" },
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
