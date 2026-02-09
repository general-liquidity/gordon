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

// ============================================================================
// Patch 1: Sub-agent lastMessages: 0 → 10
// ============================================================================

const lastMessagesFiles = [
  "node_modules/@mastra/core/dist/chunk-FKO2M32N.js",
  "node_modules/@mastra/core/dist/chunk-DNYIYX4I.cjs",
];

for (const file of lastMessagesFiles) {
  const filePath = path.resolve(__dirname, "..", file);
  if (!fs.existsSync(filePath)) {
    console.log(`[patch-mastra] Skipping ${file} (not found)`);
    continue;
  }

  let content = fs.readFileSync(filePath, "utf8");
  const needle = "            lastMessages: 0";
  const replacement = "            lastMessages: 10";

  if (content.includes(needle)) {
    content = content.replaceAll(needle, replacement);
    fs.writeFileSync(filePath, content, "utf8");
    const count = (content.match(/lastMessages: 10/g) || []).length;
    console.log(`[patch-mastra] Patched lastMessages in ${file} (${count} occurrences)`);
    totalPatched++;
  } else if (content.includes(replacement)) {
    console.log(`[patch-mastra] ${file} lastMessages already patched`);
  } else {
    console.log(`[patch-mastra] WARNING: lastMessages pattern not found in ${file}`);
  }
}

// ============================================================================
// Patch 2: OpenAI .responses() → .chat() when custom baseURL is set
// ============================================================================

const modelResolverFiles = [
  "node_modules/@mastra/core/dist/chunk-GVINAESE.js",
  "node_modules/@mastra/core/dist/chunk-UUDZ7CJ4.cjs",
];

// The original code:
//   case "openai":
//     return createOpenAI({ apiKey }).responses(modelId);
//
// Patched to use createOpenAICompatible when OPENAI_BASE_URL is set.
// createOpenAI sends OpenAI-native formats (tool_choice: "auto" as string,
// stream_options, /responses endpoint) which 3rd-party providers reject.
// createOpenAICompatible sends the compatible format that Dedalus accepts.
//
// When no custom base URL → direct OpenAI → original .responses() path.

// Custom fetch that strips tool_choice when it's "auto" for Dedalus compatibility.
// Dedalus rejects tool_choice:"auto" (string: 422) and {"type":"auto"} (object: empty response).
// Omitting tool_choice entirely is safe — "auto" is the default behavior.
const COMPAT_FETCH = `function(url, init) { if (init && init.body && typeof init.body === "string") { try { var b = JSON.parse(init.body); if (b.tool_choice === "auto" || (b.tool_choice && b.tool_choice.type === "auto")) { delete b.tool_choice; init = Object.assign({}, init, { body: JSON.stringify(b) }); } } catch(e) {} } return globalThis.fetch(url, init); }`;

// Two variants: ESM uses bare function names, CJS uses `chunk5KJXHJ4M_cjs.` prefix
const responsesPatterns = [
  // ESM — match original, v1 patch (createOpenAI.chat), and v2 patch (createOpenAICompatible without fetch)
  {
    needles: [
      `return createOpenAI({ apiKey }).responses(modelId)`,
      `return process.env.OPENAI_BASE_URL ? createOpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL }).chat(modelId) : createOpenAI({ apiKey }).responses(modelId)`,
      `return process.env.OPENAI_BASE_URL ? createOpenAICompatible({ name: "openai", apiKey, baseURL: process.env.OPENAI_BASE_URL, supportsStructuredOutputs: true }).chatModel(modelId) : createOpenAI({ apiKey }).responses(modelId)`,
    ],
    replacement: `return process.env.OPENAI_BASE_URL ? createOpenAICompatible({ name: "openai", apiKey, baseURL: process.env.OPENAI_BASE_URL, supportsStructuredOutputs: true, fetch: ${COMPAT_FETCH} }).chatModel(modelId) : createOpenAI({ apiKey }).responses(modelId)`,
  },
  // CJS — same variants with chunk prefix
  {
    needles: [
      `return chunk5KJXHJ4M_cjs.createOpenAI({ apiKey }).responses(modelId)`,
      `return process.env.OPENAI_BASE_URL ? chunk5KJXHJ4M_cjs.createOpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL }).chat(modelId) : chunk5KJXHJ4M_cjs.createOpenAI({ apiKey }).responses(modelId)`,
      `return process.env.OPENAI_BASE_URL ? chunk5KJXHJ4M_cjs.createOpenAICompatible({ name: "openai", apiKey, baseURL: process.env.OPENAI_BASE_URL, supportsStructuredOutputs: true }).chatModel(modelId) : chunk5KJXHJ4M_cjs.createOpenAI({ apiKey }).responses(modelId)`,
    ],
    replacement: `return process.env.OPENAI_BASE_URL ? chunk5KJXHJ4M_cjs.createOpenAICompatible({ name: "openai", apiKey, baseURL: process.env.OPENAI_BASE_URL, supportsStructuredOutputs: true, fetch: ${COMPAT_FETCH} }).chatModel(modelId) : chunk5KJXHJ4M_cjs.createOpenAI({ apiKey }).responses(modelId)`,
  },
];

for (const file of modelResolverFiles) {
  const filePath = path.resolve(__dirname, "..", file);
  if (!fs.existsSync(filePath)) {
    console.log(`[patch-mastra] Skipping ${file} (not found)`);
    continue;
  }

  let content = fs.readFileSync(filePath, "utf8");
  let patched = false;

  for (const { needles, replacement } of responsesPatterns) {
    // Already patched?
    if (content.includes(replacement)) {
      console.log(`[patch-mastra] ${file} OpenAI compatible already patched`);
      patched = true;
      break;
    }
    // Try each needle variant (original or previously-patched)
    for (const needle of needles) {
      if (content.includes(needle)) {
        content = content.replaceAll(needle, replacement);
        fs.writeFileSync(filePath, content, "utf8");
        console.log(`[patch-mastra] Patched OpenAI → createOpenAICompatible in ${file}`);
        totalPatched++;
        patched = true;
        break;
      }
    }
    if (patched) break;
  }

  if (!patched) {
    console.log(`[patch-mastra] WARNING: OpenAI responses pattern not found in ${file}`);
  }
}

console.log(`[patch-mastra] Done (${totalPatched} files patched)`);
