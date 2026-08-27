/**
 * Gordon ACP entry — boots an Agent Client Protocol server on stdio.
 *
 * Editors (Zed, Athas, any ACP-compatible host) spawn this as a child
 * process. JSON-RPC 2.0 over stdin/stdout per the ACP spec.
 *
 *   $ npm run acp                             # safe Node launcher
 *
 * The process blocks forever; the editor closes stdin to terminate.
 * Diagnostic output goes to stderr (stdout is reserved for ACP frames).
 */

import { assertRuntimeEnvProvenance } from "../infra/storage/config/runtimeEnvProvenance.ts";
import { GORDON_VERSION } from "../version.ts";

assertRuntimeEnvProvenance();
if (process.argv.includes("--version")) {
  console.log(`gordon-acp v${GORDON_VERSION}`);
  process.exit(0);
}

// Keep modules that install guards or read execution settings behind the
// provenance check. Static ESM imports execute dependencies before this
// module's body and would make the assertion too late.
const [
  { installProductionGuards },
  { getDefaultPermissionEngine },
  { startAcpServerOnStdio },
  { redactString },
] = await Promise.all([
  import("../infra/safety/installProductionGuards.ts"),
  import("../runtime/permissions/defaultPermissionEngine.ts"),
  import("../infra/acp/server.ts"),
  import("../infra/platform/observability/valueRedaction.ts"),
]);

installProductionGuards();
getDefaultPermissionEngine();

// Surface fatal errors on stderr — keeps stdout clean for ACP traffic.
// Redact the message and drop the stack: a stack trace to an editor's stderr
// can leak absolute paths, env values, and secrets interpolated into errors.
process.on("uncaughtException", (err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[gordon-acp] uncaught: ${redactString(message)}\n`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  process.stderr.write(`[gordon-acp] unhandled rejection: ${redactString(message)}\n`);
  process.exit(1);
});

startAcpServerOnStdio();
process.stderr.write("[gordon-acp] listening on stdio\n");
