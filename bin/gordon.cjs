#!/usr/bin/env node

// Source/npm launcher. Node intentionally owns the first process: unlike Bun,
// it does not implicitly load <cwd>/.env. The child therefore inherits the
// operator's real shell environment and starts Bun with dotenv autoload off.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const bundledEntry = path.join(root, "dist", "entry.js");
const bundledAcpEntry = path.join(root, "dist", "acp-entry.js");
const bundledMcpEntry = path.join(root, "dist", "serveCli.js");
const sourceEntry = path.join(root, "src", "entry.ts");
const sourceAcpEntry = path.join(root, "src", "app", "acp-entry.ts");
const sourceMcpEntry = path.join(root, "src", "infra", "ai", "mcp", "serveCli.ts");
const cwdEnvCredentialAllowlist = new Set(
  require(path.join(root, "assets", "cwd-env-credential-allowlist.json")),
);
const bunImplicitDotenvNames = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
]);
// A checkout may retain an old dist/ from an earlier build. Prefer the source
// entry when it exists so development never executes stale bundled safety or
// version code; the published package excludes src/ and therefore selects the
// freshly built dist/ entry.
const requestedSourceMode = process.argv[2]?.match(/^--gordon-source-mode=(acp|mcp)$/)?.[1];
const forwardedArgs = requestedSourceMode ? process.argv.slice(3) : process.argv.slice(2);
const entry =
  requestedSourceMode === "acp"
    ? fs.existsSync(sourceAcpEntry)
      ? sourceAcpEntry
      : bundledAcpEntry
    : requestedSourceMode === "mcp"
      ? fs.existsSync(sourceMcpEntry)
        ? sourceMcpEntry
        : bundledMcpEntry
      : fs.existsSync(sourceEntry)
        ? sourceEntry
        : bundledEntry;
if (requestedSourceMode && !fs.existsSync(entry)) {
  console.error("[gordon] requested entry is not installed");
  process.exit(1);
}

function forbiddenCwdEnvKeys() {
  const keys = new Set();
  const candidates = [];
  for (const name of bunImplicitDotenvNames) {
    const candidate = path.join(process.cwd(), name);
    try {
      fs.lstatSync(candidate);
      candidates.push(candidate);
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  for (const envPath of candidates) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      const name = match?.[1];
      if (name && !cwdEnvCredentialAllowlist.has(name)) keys.add(name);
    }
  }
  return [...keys].sort();
}

// No launch marker can prove whether an inherited value came from the shell or
// Bun's pre-source dotenv loader. Reject every non-credential cwd key even
// under Node; the supported operator settings live in ~/.gordon/.env and the
// settings store, while repository dotenv files are credential-only.
const ambiguousKeys = forbiddenCwdEnvKeys();
if (ambiguousKeys.length > 0) {
  console.error(
    `[gordon] Refusing launch: an implicit cwd dotenv file contains non-credential keys (${ambiguousKeys.join(
      ", ",
    )}). Move operator controls to ~/.gordon/.env or the Gordon settings store.`,
  );
  process.exit(1);
}

const child = spawn(
  "bun",
  [
    `--config=${path.join(root, "assets", "bunfig.runtime.toml")}`,
    "--no-env-file",
    entry,
    ...forwardedArgs,
  ],
  {
    stdio: "inherit",
    env: process.env,
  },
);

child.on("error", (error) => {
  console.error(`[gordon] Failed to launch Bun: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
