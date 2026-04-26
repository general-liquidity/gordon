#!/usr/bin/env bun
/**
 * @gordon/binance-cli-mcp
 *
 * Standalone MCP server that wraps the official @binance/binance-cli.
 * Exposes a single tool, `binance_cli`, that takes an arg array and
 * returns stdout/stderr from a child-process run of binance-cli.
 *
 * Auth flows entirely through binance-cli's own profile / env-var
 * mechanism (run `binance-cli profile create` once outside this wrapper
 * to configure). Mutating commands require GORDON_BINANCE_CLI_WRITE=1.
 *
 * Discovery: Gordon's MCP marketplace catalog
 * (src/infra/ai/mcp/marketplace/catalog.json :: 'binance-cli').
 * Install via the marketplace UI or directly:
 *   `bun run wrappers/binance-cli-mcp/index.ts`.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";

const BIN_NAME = process.env.GORDON_BINANCE_CLI_BIN ?? "binance-cli";
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 200_000;

const WRITE_VERBS = new Set([
  "order",
  "place",
  "create",
  "cancel",
  "transfer",
  "withdraw",
  "convert",
  "subscribe",
  "redeem",
  "stake",
  "unstake",
  "borrow",
  "repay",
  "send",
  "claim",
]);

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
  error?: string;
  blocked?: boolean;
}

async function runBinanceCli(input: {
  args: string[];
  profile?: string;
  env?: "prod" | "demo" | "testnet";
}): Promise<RunResult> {
  const { args, profile, env } = input;

  if (!Array.isArray(args) || args.length === 0) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      error: "args[] required (no binary name; pass subcommand + flags)",
      blocked: true,
    };
  }

  // binance-cli grammar: <product> <action> [flags...]. Verbs always
  // precede the first flag, so we scan only positionals before any
  // `-flag` to avoid flag-value false positives like `--type transfer`.
  const positionalsBeforeFlags: string[] = [];
  for (const t of args) {
    if (t.startsWith("-")) break;
    positionalsBeforeFlags.push(t.toLowerCase());
    if (positionalsBeforeFlags.length >= 3) break;
  }
  const isWrite = positionalsBeforeFlags.some((v) => WRITE_VERBS.has(v));
  if (isWrite && process.env.GORDON_BINANCE_CLI_WRITE !== "1") {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      error:
        "Write command refused: set GORDON_BINANCE_CLI_WRITE=1 to enable mutating " +
        "subcommands. Read-only queries run freely.",
      blocked: true,
    };
  }

  const finalArgs = [...args];
  if (profile && !finalArgs.includes("--profile")) finalArgs.push("--profile", profile);

  return new Promise<RunResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;

    const child = spawn(BIN_NAME, finalArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(env ? { BINANCE_API_ENV: env } : {}) },
      shell: false,
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000);
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBytes >= MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      stdoutBytes += chunk.length;
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes >= MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      stderrBytes += chunk.length;
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      const msg = err.message || String(err);
      if (msg.includes("ENOENT")) {
        resolve({
          ok: false,
          stdout: "",
          stderr: "",
          error:
            "binance-cli not installed. Run: npm install -g @binance/binance-cli " +
            "(or set GORDON_BINANCE_CLI_BIN to its binary path).",
          blocked: true,
        });
        return;
      }
      resolve({ ok: false, stdout, stderr, error: msg });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const trailer = truncated ? "\n[output truncated — re-run with narrower args]" : "";
      resolve({
        ok: code === 0,
        stdout: stdout + trailer,
        stderr,
        exitCode: code ?? undefined,
      });
    });
  });
}

// ---- MCP server -----------------------------------------------------------

const server = new Server(
  { name: "binance-cli-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "binance_cli",
      description:
        "Run the official @binance/binance-cli and return its stdout. " +
        "Useful for the long tail of Binance products (VIP loan, mining, " +
        "gift cards, dual investment, sub-account ops, copy-trading admin, " +
        "50+ niche endpoints). Auth via binance-cli's own profile " +
        "mechanism. Mutating commands require GORDON_BINANCE_CLI_WRITE=1.",
      inputSchema: {
        type: "object",
        required: ["args"],
        properties: {
          args: {
            type: "array",
            items: { type: "string" },
            description: "Argument array passed to binance-cli (no binary name).",
          },
          profile: { type: "string", description: "Optional --profile shortcut" },
          env: {
            type: "string",
            enum: ["prod", "demo", "testnet"],
            description: "Override BINANCE_API_ENV for this single invocation.",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "binance_cli") {
    return {
      content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      isError: true,
    };
  }
  const result = await runBinanceCli((req.params.arguments ?? {}) as Parameters<typeof runBinanceCli>[0]);
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
