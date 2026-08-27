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
 * Patch 2: OpenAI-compatible provider support (legacy Mastra only)
 *   Mastra hardcodes `.responses(modelId)` for the openai case, which hits
 *   /v1/responses. Dedalus (and other OpenAI-compatible providers) only support
 *   /v1/chat/completions. This patch makes the openai case use .chat() when
 *   a custom baseURL is set (i.e., OPENAI_BASE_URL points to a non-OpenAI API).
 *   Modern Mastra resolves an object model with `url` through
 *   `createOpenAICompatible(...).chatModel()` itself. When that native route
 *   exists, this script records the compatibility as satisfied and makes no
 *   dependency mutation.
 *
 * Run automatically via postinstall, or manually: node scripts/patch-mastra.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

let totalPatched = 0;
const verbose = process.argv.includes("--verbose") || process.env.PATCH_MASTRA_VERBOSE === "1";

const distDir = path.resolve(__dirname, "..", "..", "node_modules/@mastra/core/dist");

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
  const name = path.relative(path.resolve(__dirname, "..", ".."), filePath);
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
  const name = path.relative(path.resolve(__dirname, "..", ".."), filePath);
  const isCjs = filePath.endsWith(".cjs");

  // Detect the CJS chunk prefix (e.g., "chunkSH4PCZ3X_cjs.")
  let cjsPrefix = "";
  if (isCjs) {
    const prefixMatch = content.match(/(\w+_cjs)\.createOpenAI\(/);
    if (prefixMatch) cjsPrefix = `${prefixMatch[1]}.`;
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
  const nativeCompatibleFiles = fs.existsSync(distDir)
    ? fs
        .readdirSync(distDir)
        .filter((fileName) => /\.(js|cjs)$/.test(fileName))
        .map((fileName) => path.join(distDir, fileName))
        .filter((filePath) => {
          const content = fs.readFileSync(filePath, "utf8");
          return (
            content.includes("this.config.url") &&
            content.includes("createOpenAICompatible({") &&
            content.includes(".chatModel(modelId)")
          );
        })
    : [];

  if (nativeCompatibleFiles.length > 0) {
    log("[patch-mastra] Native OpenAI-compatible chat routing detected; no patch required");
  } else {
    warn(
      "[patch-mastra] WARNING: Neither the legacy responses pattern nor native compatible chat routing was found",
    );
  }
}

if (verbose && totalPatched > 0) {
  console.log(`[patch-mastra] Done (${totalPatched} files patched)`);
}
