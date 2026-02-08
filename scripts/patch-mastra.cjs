/**
 * Patch Mastra's Agent Network to give sub-agents conversation history.
 *
 * Mastra hardcodes `lastMessages: 0` for sub-agents in network routing,
 * which strips all conversation context. This patch changes it to 10
 * so sub-agents can see recent messages and understand follow-up requests
 * like "check whale activity" after analyzing DUSKUSDT.
 *
 * Run automatically via postinstall, or manually: node scripts/patch-mastra.js
 */

const fs = require("fs");
const path = require("path");

const files = [
  "node_modules/@mastra/core/dist/chunk-FKO2M32N.js",
  "node_modules/@mastra/core/dist/chunk-DNYIYX4I.cjs",
];

let patched = 0;

for (const file of files) {
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
    console.log(`[patch-mastra] Patched ${file} (${count} occurrences)`);
    patched++;
  } else if (content.includes(replacement)) {
    console.log(`[patch-mastra] ${file} already patched`);
  } else {
    console.log(`[patch-mastra] WARNING: Pattern not found in ${file}`);
  }
}

console.log(`[patch-mastra] Done (${patched} files patched)`);
