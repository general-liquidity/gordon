#!/usr/bin/env bun
/**
 * Gordon ACP entry — boots an Agent Client Protocol server on stdio.
 *
 * Editors (Zed, Athas, any ACP-compatible host) spawn this as a child
 * process. JSON-RPC 2.0 over stdin/stdout per the ACP spec.
 *
 *   $ bun run src/app/acp-entry.ts            # direct
 *   $ bun acp                                 # via package.json script
 *
 * The process blocks forever; the editor closes stdin to terminate.
 * Diagnostic output goes to stderr (stdout is reserved for ACP frames).
 */

import { installProductionGuards } from "../infra/safety/installProductionGuards.ts";
import { getDefaultPermissionEngine } from "../runtime/permissions/defaultPermissionEngine.ts";
import { startAcpServerOnStdio } from "../infra/acp/server.ts";
import { redactString } from "../infra/platform/observability/valueRedaction.ts";

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
