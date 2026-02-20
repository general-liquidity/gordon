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
 * Run automatically via postinstall, or manually: node scripts/patch-mastra.cjs
 */

const fs = require("fs");
const path = require("path");

let totalPatched = 0;

const distDir = path.resolve(__dirname, "..", "node_modules/@mastra/core/dist");

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
    console.log(`[patch-mastra] lastMessages already patched (${alreadyPatched.length} files)`);
  } else {
    console.log(`[patch-mastra] WARNING: lastMessages pattern not found in any chunk file`);
  }
}

for (const filePath of lastMessagesFiles) {
  let content = fs.readFileSync(filePath, "utf8");
  content = content.replaceAll(lastMessagesNeedle, lastMessagesReplacement);
  fs.writeFileSync(filePath, content, "utf8");
  const count = (content.match(/lastMessages: 10/g) || []).length;
  const name = path.relative(path.resolve(__dirname, ".."), filePath);
  console.log(`[patch-mastra] Patched lastMessages in ${name} (${count} occurrences)`);
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
    console.log(`[patch-mastra] ${name} OpenAI compatible already patched`);
    continue;
  }

  let patched = false;
  for (const needle of needles) {
    if (content.includes(needle)) {
      // Pick the right replacement based on whether the original had baseURL/headers
      const replacement = needle.includes("baseURL, headers") ? replacementNew : replacementOld;
      content = content.replaceAll(needle, replacement);
      fs.writeFileSync(filePath, content, "utf8");
      console.log(`[patch-mastra] Patched OpenAI → createOpenAICompatible in ${name}`);
      totalPatched++;
      patched = true;
      break;
    }
  }

  if (!patched) {
    console.log(`[patch-mastra] WARNING: Could not match OpenAI responses pattern in ${name}`);
  }
}

if (responsesFiles.length === 0) {
  console.log(`[patch-mastra] WARNING: No chunk files found containing .responses(modelId)`);
}

console.log(`[patch-mastra] Done (${totalPatched} files patched)`);
