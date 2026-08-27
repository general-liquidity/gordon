import cwdEnvCredentialAllowlist from "../../../../assets/cwd-env-credential-allowlist.json";

const ALLOWED_CWD_ENV_KEYS = new Set<string>(cwdEnvCredentialAllowlist);

/**
 * The complete set of keys a repository-carried `<cwd>/.env` may provide.
 *
 * Gordon accepts credentials here for development convenience. Everything
 * else is refused, including generic runtime selectors and endpoint URLs:
 * those can redirect durable state or execution without using a GORDON_ name.
 * This module is intentionally dependency-free so the pre-autoload provenance
 * guard and the ordinary environment loader enforce exactly the same policy.
 */
export function isAllowedCwdEnvKey(name: string): boolean {
  return ALLOWED_CWD_ENV_KEYS.has(name);
}
