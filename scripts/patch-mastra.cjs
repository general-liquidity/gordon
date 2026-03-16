/**
 * Patch Mastra's Agent Network for Gordon compatibility.
 *
 * Patch 1: Sub-agent conversation history
 *   Mastra hardcodes `lastMessages: 0` for sub-agents in network routing,
 *   which strips all conversation context. This patch changes it to 10
 *   so sub-agents can see recent messages and understand follow-up requests
 *   like "check whale activity" after analyzing DUSKUSDT.
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
// Patch 1: Sub-agent lastMessages: 0 → 10
// ============================================================================

const lastMessagesNeedle = "            lastMessages: 0";
const lastMessagesReplacement = "            lastMessages: 10";

const lastMessagesFiles = findChunkFiles(lastMessagesNeedle);
if (lastMessagesFiles.length === 0) {
  // Check if already patched
  const alreadyPatched = findChunkFiles(lastMessagesReplacement);
  if (alreadyPatched.length > 0) {
    log(`[patch-mastra] lastMessages already patched (${alreadyPatched.length} files)`);
  } else {
    warn(`[patch-mastra] WARNING: lastMessages pattern not found in any chunk file`);
  }
}

for (const filePath of lastMessagesFiles) {
  let content = fs.readFileSync(filePath, "utf8");
  content = content.replaceAll(lastMessagesNeedle, lastMessagesReplacement);
  fs.writeFileSync(filePath, content, "utf8");
  const count = (content.match(/lastMessages: 10/g) || []).length;
  const name = path.relative(path.resolve(__dirname, ".."), filePath);
  log(`[patch-mastra] Patched lastMessages in ${name} (${count} occurrences)`);
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
