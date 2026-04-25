/**
 * Patch Mastra's Agent Network for Gordon compatibility.
 *
 * Patch 1: Sub-agent conversation history (DISABLED — was lastMessages 0 → 10).
 *   Originally we patched Mastra's hardcoded `lastMessages: 0` to 10 for
 *   sub-agents so they could see follow-up context. The unintended consequence
 *   was that every routing-agent + sub-agent call carried 10 turns × heavy
 *   tool-call payloads, blowing the 200k context ceiling after ~50 chat
 *   turns ("prompt is too long: 206062 tokens > 200000 maximum").
 *
 *   Per Claude Code's audited pattern: send all messages until compaction
 *   fires; don't artificially window. Mastra's 0-default + Gordon's
 *   compaction layer + the new clear_tool_uses_20250919 beta on Anthropic
 *   together replace what this patch was hacking around.
 *
 *   Leaving the code path here so the patch is greppable and reversible —
 *   we just no longer mutate the Mastra binary.
 *
 * Patch 2: OpenAI-compatible provider support (Dedalus)
 *   Mastra hardcodes `.responses(modelId)` for the openai case, which hits
 *   /v1/responses. Dedalus (and other OpenAI-compatible providers) only support
 *   /v1/chat/completions. This patch makes the openai case use .chat() when
 *   a custom baseURL is set (i.e., OPENAI_BASE_URL points to a non-OpenAI API).
 *
 * Patch 3: Solana rpc-parsed-types empty CJS stubs
 *   Several @solana/rpc-parsed-types packages ship an effectively empty
 *   index.node.cjs file that only contains sourceMappingURL comments.
 *   Bun's bundler currently turns `require("@solana/rpc-parsed-types")`
 *   into invalid code (`var rpcParsedTypes = ;`) when compiling Gordon.
 *   This patch replaces those empty stubs with `module.exports = {};`
 *   so Bun emits valid bundles.
 *
 * Patch 4: Solana plugin-token CJS interop
 *   @solana-agent-kit/plugin-token imports named exports from CommonJS
 *   lightprotocol packages. Bun's standalone compiler rejects those
 *   named imports, so we rewrite them to namespace imports.
 *
 * Run automatically via postinstall, or manually: node scripts/patch-mastra.cjs
 */

const fs = require("fs");
const path = require("path");

let totalPatched = 0;
const verbose = process.argv.includes("--verbose") || process.env.PATCH_MASTRA_VERBOSE === "1";

const distDir = path.resolve(__dirname, "..", "node_modules/@mastra/core/dist");

function log(message) {
  if (verbose) {
    console.log(message);
  }
}

function warn(message) {
  console.warn(message);
}

/**
 * Scan dist directory for chunk files matching a pattern in their content.
 * Returns relative paths from the project root.
 */
function findChunkFiles(contentPattern) {
  if (!fs.existsSync(distDir)) return [];
  return fs
    .readdirSync(distDir)
    .filter((f) => /^chunk-.+\.(js|cjs)$/.test(f))
    .filter((f) => {
      const content = fs.readFileSync(path.join(distDir, f), "utf8");
      return content.includes(contentPattern);
    })
    .map((f) => path.join(distDir, f));
}

// ============================================================================
// Patch 1: Sub-agent lastMessages — DISABLED (see header). Keep stub for
// reversibility: revert any prior `lastMessages: 10` mutation back to the
// Mastra default of 0 in case a previous postinstall already mutated the
// dist files.
// ============================================================================

const STALE_LAST_MESSAGES_NEEDLE = "            lastMessages: 10";
const MASTRA_DEFAULT = "            lastMessages: 0";
const staleFiles = findChunkFiles(STALE_LAST_MESSAGES_NEEDLE);
for (const filePath of staleFiles) {
  let content = fs.readFileSync(filePath, "utf8");
  content = content.replaceAll(STALE_LAST_MESSAGES_NEEDLE, MASTRA_DEFAULT);
  fs.writeFileSync(filePath, content, "utf8");
  const name = path.relative(path.resolve(__dirname, ".."), filePath);
  log(`[patch-mastra] Reverted stale lastMessages mutation in ${name} → 0 (Mastra default)`);
  totalPatched++;
}

// ============================================================================
// Patch 2: OpenAI .responses() → createOpenAICompatible when custom baseURL
// ============================================================================

// Custom fetch that strips tool_choice when it's "auto" for Dedalus compatibility.
// Dedalus rejects tool_choice:"auto" (string: 422) and {"type":"auto"} (object: empty response).
// Omitting tool_choice entirely is safe — "auto" is the default behavior.
const COMPAT_FETCH = `function(url, init) { if (init && init.body && typeof init.body === "string") { try { var b = JSON.parse(init.body); if (b.tool_choice === "auto" || (b.tool_choice && b.tool_choice.type === "auto")) { delete b.tool_choice; init = Object.assign({}, init, { body: JSON.stringify(b) }); } } catch(e) {} } return globalThis.fetch(url, init); }`;

// Find all chunk files containing .responses(modelId)
const responsesFiles = findChunkFiles(".responses(modelId)");

for (const filePath of responsesFiles) {
  let content = fs.readFileSync(filePath, "utf8");
  const name = path.relative(path.resolve(__dirname, ".."), filePath);
  const isCjs = filePath.endsWith(".cjs");

  // Detect the CJS chunk prefix (e.g., "chunkSH4PCZ3X_cjs.")
  let cjsPrefix = "";
  if (isCjs) {
    const prefixMatch = content.match(/(\w+_cjs)\.createOpenAI\(/);
    if (prefixMatch) cjsPrefix = prefixMatch[1] + ".";
  }

  const fn = (name) => (cjsPrefix ? `${cjsPrefix}${name}` : name);

  // All needle variants we might encounter (original or previously patched)
  const needles = [
    // Original: createOpenAI({ apiKey }).responses(modelId)
    `return ${fn("createOpenAI")}({ apiKey }).responses(modelId)`,
    // Original v2 (core 1.5.0): createOpenAI({ apiKey, baseURL, headers }).responses(modelId)
    `return ${fn("createOpenAI")}({ apiKey, baseURL, headers }).responses(modelId)`,
    // Previously patched v1: createOpenAI.chat()
    `return process.env.OPENAI_BASE_URL ? ${fn("createOpenAI")}({ apiKey, baseURL: process.env.OPENAI_BASE_URL }).chat(modelId) : ${fn("createOpenAI")}({ apiKey }).responses(modelId)`,
    // Previously patched v2: createOpenAICompatible without fetch
    `return process.env.OPENAI_BASE_URL ? ${fn("createOpenAICompatible")}({ name: "openai", apiKey, baseURL: process.env.OPENAI_BASE_URL, supportsStructuredOutputs: true }).chatModel(modelId) : ${fn("createOpenAI")}({ apiKey }).responses(modelId)`,
  ];

  // Replacement for old-style (no baseURL in original call)
  const replacementOld = `return process.env.OPENAI_BASE_URL ? ${fn("createOpenAICompatible")}({ name: "openai", apiKey, baseURL: process.env.OPENAI_BASE_URL, supportsStructuredOutputs: true, fetch: ${COMPAT_FETCH} }).chatModel(modelId) : ${fn("createOpenAI")}({ apiKey }).responses(modelId)`;

  // Replacement for new-style (baseURL, headers in original call)
  const replacementNew = `return process.env.OPENAI_BASE_URL ? ${fn("createOpenAICompatible")}({ name: "openai", apiKey, baseURL: process.env.OPENAI_BASE_URL, supportsStructuredOutputs: true, fetch: ${COMPAT_FETCH} }).chatModel(modelId) : ${fn("createOpenAI")}({ apiKey, baseURL, headers }).responses(modelId)`;

  // Check if already has our final patch
  if (content.includes(replacementOld) || content.includes(replacementNew)) {
    log(`[patch-mastra] ${name} OpenAI compatible already patched`);
    continue;
  }

  let patched = false;
  for (const needle of needles) {
    if (content.includes(needle)) {
      // Pick the right replacement based on whether the original had baseURL/headers
      const replacement = needle.includes("baseURL, headers") ? replacementNew : replacementOld;
      content = content.replaceAll(needle, replacement);
      fs.writeFileSync(filePath, content, "utf8");
      log(`[patch-mastra] Patched OpenAI → createOpenAICompatible in ${name}`);
      totalPatched++;
      patched = true;
      break;
    }
  }

  if (!patched) {
    warn(`[patch-mastra] WARNING: Could not match OpenAI responses pattern in ${name}`);
  }
}

if (responsesFiles.length === 0) {
  warn(`[patch-mastra] WARNING: No chunk files found containing .responses(modelId)`);
}

// ============================================================================
// Patch 3: @solana/rpc-parsed-types empty CJS stub → module.exports = {}
// ============================================================================

const nodeModulesDir = path.resolve(__dirname, "..", "node_modules");
const solanaStubReplacement = `'use strict';\n\nmodule.exports = {};\n`;

function findRpcParsedTypesCjsFiles() {
  if (!fs.existsSync(nodeModulesDir)) return [];

  return fs
    .readdirSync(nodeModulesDir, { recursive: true })
    .filter((relativePath) =>
      relativePath.endsWith(path.join("@solana", "rpc-parsed-types", "dist", "index.node.cjs")),
    )
    .map((relativePath) => path.join(nodeModulesDir, relativePath));
}

for (const filePath of findRpcParsedTypesCjsFiles()) {
  const content = fs.readFileSync(filePath, "utf8");
  const normalized = content.trim();

  if (normalized === "'use strict';\n\nmodule.exports = {};") {
    continue;
  }

  const isEmptyCommonJsStub =
    normalized.startsWith("'use strict';")
    && normalized.includes("sourceMappingURL=index.node.cjs.map")
    && !normalized.includes("module.exports");

  if (!isEmptyCommonJsStub) {
    continue;
  }

  fs.writeFileSync(filePath, solanaStubReplacement, "utf8");
  totalPatched++;
  log(`[patch-mastra] Patched empty rpc-parsed-types stub in ${path.relative(path.resolve(__dirname, ".."), filePath)}`);
}

// ============================================================================
// Patch 4: @solana-agent-kit/plugin-token named CJS imports → namespace imports
// ============================================================================

const pluginTokenDistPath = path.resolve(
  __dirname,
  "..",
  "node_modules/@solana-agent-kit/plugin-token/dist/index.js",
);
const pluginTokenNeedle = [
  'import { CompressedTokenProgram } from "@lightprotocol/compressed-token";',
  "import {",
  "  buildTx,",
  "  calculateComputeUnitPrice",
  '} from "@lightprotocol/stateless.js";',
].join("\n");
const pluginTokenReplacement = [
  'import * as compressedToken from "@lightprotocol/compressed-token";',
  'import * as statelessJs from "@lightprotocol/stateless.js";',
  "const { CompressedTokenProgram } = compressedToken;",
  "const { buildTx, calculateComputeUnitPrice } = statelessJs;",
].join("\n");

if (fs.existsSync(pluginTokenDistPath)) {
  const content = fs.readFileSync(pluginTokenDistPath, "utf8");

  if (content.includes(pluginTokenReplacement)) {
    log("[patch-mastra] plugin-token lightprotocol imports already patched");
  } else if (content.includes(pluginTokenNeedle)) {
    fs.writeFileSync(
      pluginTokenDistPath,
      content.replace(pluginTokenNeedle, pluginTokenReplacement),
      "utf8",
    );
    totalPatched++;
    log("[patch-mastra] Patched plugin-token lightprotocol imports for Bun CJS interop");
  } else {
    warn("[patch-mastra] WARNING: Could not match plugin-token lightprotocol import block");
  }
}

if (verbose && totalPatched > 0) {
  console.log(`[patch-mastra] Done (${totalPatched} files patched)`);
}
