// ============================================================================
// Sanitizer — Auto-redact sensitive data in logs and output
//
// Auto-redact API keys, wallet addresses, private keys, and sensitive data
// from terminal output and log files. Undercover/sanitization mode.
// ============================================================================

export interface SanitizeConfig {
  enabled: boolean;
  patterns: RedactionPattern[];
}

export interface RedactionPattern {
  name: string;
  regex: RegExp;
  replacement: string;
}

const DEFAULT_PATTERNS: RedactionPattern[] = [
  { name: "api-key", regex: /(?:sk-|dd-|ak-)[a-zA-Z0-9\-_]{16,}/g, replacement: "***API_KEY***" },
  { name: "eth-address", regex: /0x[a-fA-F0-9]{40}/g, replacement: "***ETH_ADDR***" },
  { name: "private-key", regex: /(?:0x)?[a-fA-F0-9]{64}/g, replacement: "***PRIVATE_KEY***" },
  { name: "btc-address", regex: /[13][a-km-zA-HJ-NP-Z1-9]{25,34}/g, replacement: "***BTC_ADDR***" },
  { name: "solana-address", regex: /[1-9A-HJ-NP-Za-km-z]{32,44}/g, replacement: "***SOL_ADDR***" },
  {
    name: "bearer-token",
    regex: /Bearer\s+[a-zA-Z0-9\-_.~+/]+=*/g,
    replacement: "Bearer ***TOKEN***",
  },
  {
    name: "password-field",
    regex: /(password|secret|token)\s*[=:]\s*\S+/gi,
    replacement: "$1=***REDACTED***",
  },
];

const config: SanitizeConfig = {
  enabled: true,
  patterns: [...DEFAULT_PATTERNS],
};

export function sanitize(text: string, overrideConfig?: SanitizeConfig): string {
  const cfg = overrideConfig ?? config;
  if (!cfg.enabled) return text;

  let result = text;
  for (const pattern of cfg.patterns) {
    // Reset lastIndex for global regexes
    pattern.regex.lastIndex = 0;
    result = result.replace(pattern.regex, pattern.replacement);
  }
  return result;
}

export function isSensitive(text: string): boolean {
  for (const pattern of config.patterns) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(text)) return true;
  }
  return false;
}

export function getSanitizeConfig(): SanitizeConfig {
  return { ...config, patterns: [...config.patterns] };
}

export function setSanitizeEnabled(enabled: boolean): void {
  config.enabled = enabled;
}
