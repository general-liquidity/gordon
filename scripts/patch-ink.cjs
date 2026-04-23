/**
 * Patch Ink's render scheduler to defer terminal paints via queueMicrotask.
 *
 * Ink 6.x schedules renders by assigning onRender directly to a throttled
 * wrapper. This means useLayoutEffect state (cursor position, scroll offsets)
 * may not yet be committed when the terminal write fires, causing cursor
 * declarations to lag one frame behind.
 *
 * Claude Code's internal Ink fork wraps the throttled callback in
 * queueMicrotask() so React's layout phase (useLayoutEffect / ref attach)
 * always completes before the terminal paint. We apply the same fix here.
 *
 * Before:
 *   this.rootNode.onRender = unthrottled
 *       ? this.onRender
 *       : throttle(this.onRender, renderThrottleMs, { leading: true, trailing: true });
 *
 * After:
 *   const deferredRender = () => queueMicrotask(this.onRender.bind(this));
 *   this.rootNode.onRender = unthrottled
 *       ? this.onRender
 *       : throttle(deferredRender, renderThrottleMs, { leading: true, trailing: true });
 *
 * Run automatically via postinstall, or manually: node scripts/patch-ink.cjs
 */

const fs = require("fs");
const path = require("path");

const verbose = process.argv.includes("--verbose") || process.env.PATCH_INK_VERBOSE === "1";

function log(message) {
  if (verbose) {
    console.log(message);
  }
}

function warn(message) {
  console.warn(message);
}

const inkPath = path.resolve(__dirname, "..", "node_modules", "ink", "build", "ink.js");

if (!fs.existsSync(inkPath)) {
  warn("[patch-ink] WARNING: ink.js not found at " + inkPath + " — skipping.");
  process.exit(0);
}

const content = fs.readFileSync(inkPath, "utf8");

// Idempotency check — if already patched, do nothing.
if (content.includes("deferredRender")) {
  log("[patch-ink] Already patched — skipping.");
  process.exit(0);
}

// Detect line ending style
const crlf = content.includes("\r\n");
const eol = crlf ? "\r\n" : "\n";

const indent8 = "        ";
const indent12 = "            ";
const indent16 = "                ";

// Build needle and replacement using detected line endings
const needle = [
  indent8 + "this.rootNode.onRender = unthrottled",
  indent12 + "? this.onRender",
  indent12 + ": throttle(this.onRender, renderThrottleMs, {",
  indent16 + "leading: true,",
  indent16 + "trailing: true,",
  indent12 + "});",
].join(eol);

const replacement = [
  indent8 + "// queueMicrotask defers the paint to after React's layout phase",
  indent8 + "// (useLayoutEffect / ref attach) so cursor declarations commit before",
  indent8 + "// the terminal write. Same pattern as Claude Code's Ink fork.",
  indent8 + "const deferredRender = () => queueMicrotask(this.onRender.bind(this));",
  indent8 + "this.rootNode.onRender = unthrottled",
  indent12 + "? this.onRender",
  indent12 + ": throttle(deferredRender, renderThrottleMs, {",
  indent16 + "leading: true,",
  indent16 + "trailing: true,",
  indent12 + "});",
].join(eol);

if (!content.includes(needle)) {
  warn("[patch-ink] WARNING: Could not find the target onRender pattern in ink.js.");
  warn("[patch-ink] The file may have been updated — inspect node_modules/ink/build/ink.js manually.");
  process.exit(0);
}

const patched = content.replace(needle, replacement);
fs.writeFileSync(inkPath, patched, "utf8");
console.log("[patch-ink] Patched ink.js — queueMicrotask render deferral applied.");
