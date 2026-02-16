export {
  getOrCreateDaemonToken,
  resolvePrincipalFromToken,
  requiredCapabilityForCommand,
  principalHasCapability,
  type GatewayCapability,
  type GatewayPrincipal,
} from "./auth.ts";

export { checkAndRegisterNonce, pruneExpiredNonces, type ReplayCheckResult } from "./replay.ts";

