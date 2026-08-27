/**
 * Editor-fs bridge — routes file reads + writes through the ACP
 * connection when Gordon is running as an ACP subprocess.
 *
 * Per the ACP spec, the editor implements two CLIENT methods Gordon
 * (as agent) can call:
 *
 *   - `fs/read_text_file` { path, sessionId }   → { content }
 *   - `fs/write_text_file` { path, sessionId, content } → {}
 *
 * These let Gordon access the editor's workspace through the editor's
 * own filesystem permissions (sandbox, virtual files, remote
 * workspaces over SSH), rather than bypassing them via Node's fs.
 *
 * `readTextFileViaAcp` / `writeTextFileViaAcp` wrap the connection
 * calls with a fallback path: if the editor doesn't advertise the
 * capability OR the call fails, the helper falls through to Node's
 * `fs.readFileSync` / `fs.writeFileSync` — preserves Gordon's existing
 * behavior outside ACP and during partial-capability sessions.
 */

import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("acp-fs-bridge");

export interface AcpFsOptions {
  /** Connection to the ACP client. When undefined, all reads/writes go through Node fs. */
  connection?: AgentSideConnection;
  /** Session id required for ACP fs calls. */
  sessionId?: string;
  /** Whether the editor advertised fs.readTextFile capability in initialize. */
  clientReadCapable?: boolean;
  /** Whether the editor advertised fs.writeTextFile capability in initialize. */
  clientWriteCapable?: boolean;
}

/**
 * Read a text file. Prefers the editor's fs/read_text_file when both
 * a connection is present AND the editor advertised the capability.
 * Falls back to Node's fs.readFileSync on failure or when out of ACP mode.
 */
export async function readTextFileViaAcp(path: string, opts: AcpFsOptions = {}): Promise<string> {
  if (opts.connection && opts.sessionId && opts.clientReadCapable) {
    try {
      const response = await opts.connection.readTextFile({
        sessionId: opts.sessionId,
        path,
      });
      return response.content;
    } catch (err) {
      logger.debug("ACP fs/read_text_file failed — falling back to local fs", {
        path,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }
  return readFileSync(path, "utf-8");
}

/**
 * Write a text file. Prefers the editor's fs/write_text_file when
 * available; falls back to Node's fs.writeFileSync.
 */
export async function writeTextFileViaAcp(
  path: string,
  content: string,
  opts: AcpFsOptions = {},
): Promise<void> {
  if (opts.connection && opts.sessionId && opts.clientWriteCapable) {
    try {
      await opts.connection.writeTextFile({
        sessionId: opts.sessionId,
        path,
        content,
      });
      return;
    } catch (err) {
      logger.debug("ACP fs/write_text_file failed — falling back to local fs", {
        path,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  writeFileSync(path, content, "utf-8");
}
