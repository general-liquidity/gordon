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

// Idempotency check — only apply if not already patched.
if (content.includes("deferredRender")) {
  log("[patch-ink] ink.js already patched (queueMicrotask) — skipping.");
} else {
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
  } else {
    const patched = content.replace(needle, replacement);
    fs.writeFileSync(inkPath, patched, "utf8");
    console.log("[patch-ink] Patched ink.js — queueMicrotask render deferral applied.");
  }
}

// ============================================================================
// Patch 2: BSU/ESU synchronized output in log-update.js
//
// Wraps every frame write in Begin/End Synchronized Update escape sequences
// so the terminal composites the frame atomically — eliminating partial-frame
// flicker (visual tearing) on supported terminals.
//
// BSU: \x1b[?2026h  (DEC private mode 2026 — Begin Synchronized Update)
// ESU: \x1b[?2026l  (End Synchronized Update)
//
// Supported terminals: iTerm2, WezTerm, Ghostty, kitty, foot, Contour,
//                      Windows Terminal (WT_SESSION env var).
// Unsupported terminals silently ignore these sequences — safe to always send.
//
// The createIncremental render path (active when incrementalRendering: true)
// has two frame-writing stream.write() calls. We wrap both.
// ============================================================================

const logUpdatePath = path.resolve(__dirname, "..", "node_modules", "ink", "build", "log-update.js");

if (!fs.existsSync(logUpdatePath)) {
  warn("[patch-ink] WARNING: log-update.js not found at " + logUpdatePath + " — skipping BSU/ESU patch.");
} else {
  let logUpdateContent = fs.readFileSync(logUpdatePath, "utf8");

  // Idempotency check
  if (logUpdateContent.includes("BSU_ESU_SYNC")) {
    log("[patch-ink] log-update.js already has BSU/ESU patch — skipping.");
  } else {
    // Detect terminal support at patch time using the same heuristic as
    // LineDiffRenderer.ts and syncOutput.ts so all paths agree.
    // We emit the detection as inline JS so it runs at module load time
    // (the patched file is loaded fresh by Node on each CLI invocation).
    const syncDetectBlock = [
      "// BSU_ESU_SYNC — synchronized output support (patch-ink.cjs)",
      "const __BSU = '\\x1b[?2026h';",
      "const __ESU = '\\x1b[?2026l';",
      "const __syncSupported = (function() {",
      "  try {",
      "    const term = process.env.TERM_PROGRAM ?? '';",
      "    return /iTerm|WezTerm|Ghostty|kitty|foot|Contour/i.test(term) || !!process.env.WT_SESSION;",
      "  } catch { return false; }",
      "})();",
    ].join("\n");

    // Insert the detection block right before the createStandard declaration.
    const createStandardDecl = "const createStandard = (stream, { showCursor = false } = {}) => {";
    if (!logUpdateContent.includes(createStandardDecl)) {
      warn("[patch-ink] WARNING: Could not find createStandard declaration in log-update.js — skipping BSU/ESU patch.");
    } else {
      logUpdateContent = logUpdateContent.replace(
        createStandardDecl,
        syncDetectBlock + "\n" + createStandardDecl,
      );

      // Wrap the two frame-writing stream.write() calls in createIncremental.
      //
      // Target 1 (first-frame / blank-frame path):
      //   stream.write(ansiEscapes.eraseLines(previousCount) + output);
      const target1 = "            stream.write(ansiEscapes.eraseLines(previousCount) + output);";
      const replacement1 = [
        "            if (__syncSupported) stream.write(__BSU);",
        "            stream.write(ansiEscapes.eraseLines(previousCount) + output);",
        "            if (__syncSupported) stream.write(__ESU);",
      ].join("\n");

      // Target 2 (incremental diff buffer path):
      //   stream.write(buffer.join(''));
      const target2 = "        stream.write(buffer.join(''));";
      const replacement2 = [
        "        if (__syncSupported) stream.write(__BSU);",
        "        stream.write(buffer.join(''));",
        "        if (__syncSupported) stream.write(__ESU);",
      ].join("\n");

      const crlf2 = logUpdateContent.includes("\r\n");
      if (crlf2) {
        // Normalize targets/replacements to CRLF if the file uses CRLF
        // (Windows). This keeps the patch robust across OSes.
        logUpdateContent = logUpdateContent
          .replace(target1, replacement1.replace(/\n/g, "\r\n"))
          .replace(target2, replacement2.replace(/\n/g, "\r\n"));
      } else {
        logUpdateContent = logUpdateContent
          .replace(target1, replacement1)
          .replace(target2, replacement2);
      }

      if (!logUpdateContent.includes("__syncSupported")) {
        warn("[patch-ink] WARNING: BSU/ESU patch may have failed — __syncSupported not found after replacement.");
      } else {
        fs.writeFileSync(logUpdatePath, logUpdateContent, "utf8");
        console.log("[patch-ink] Patched log-update.js — BSU/ESU synchronized output applied.");
      }
    }
  }
}

// ============================================================================
// Patch 3: charCache — tokenization memoization across frames (output.js)
//
// Ink's Output.get() calls tokenize(line) + styledCharsFromTokens(line) for
// every line on every render, even when lines haven't changed. Since a new
// Output instance is created each frame, there is no built-in caching.
//
// Claude Code's Ink fork holds a static Map<string, ClusteredChar[]> on the
// Output class — Output._charCache — so tokenization results survive across
// frame instances. Most lines are stable between renders, giving near-zero
// cost for unchanged content.
//
// Cache key  : the transformed line string (after transformer application)
// Cache value: the ClusteredChar[] array from styledCharsFromTokens(tokenize(line))
// Eviction   : clear() when size exceeds 16 384 entries (same cap as Claude Code)
//
// Patch location: inside the `write` operation loop in Output.get(), on the
// line that calls styledCharsFromTokens(tokenize(line)).
// ============================================================================

const outputJsPath = path.resolve(__dirname, "..", "node_modules", "ink", "build", "output.js");

if (!fs.existsSync(outputJsPath)) {
  warn("[patch-ink] WARNING: output.js not found at " + outputJsPath + " — skipping charCache patch.");
} else {
  let outputContent = fs.readFileSync(outputJsPath, "utf8");

  // Idempotency check
  if (outputContent.includes("charCache")) {
    log("[patch-ink] output.js already has charCache patch — skipping.");
  } else {
    // Target: the single line that performs tokenize + styledCharsFromTokens.
    // Actual line from Ink 6.6.0 output.js (4 spaces indent inside a for-of loop):
    //   "                    const characters = styledCharsFromTokens(tokenize(line));"
    const needle = "                    const characters = styledCharsFromTokens(tokenize(line));";

    if (!outputContent.includes(needle)) {
      warn("[patch-ink] WARNING: Could not find tokenize/styledCharsFromTokens line in output.js.");
      warn("[patch-ink] The file may have been updated — inspect node_modules/ink/build/output.js manually.");
    } else {
      // Replacement: wrap the expensive call in a static charCache lookup.
      // We preserve the same variable name `characters` so the rest of the
      // loop body is untouched.
      const indent = "                    ";
      const replacement = [
        indent + "// charCache: persist tokenized+styled chars across frames (patch-ink.cjs)",
        indent + "// Cap at 16 384 entries to prevent unbounded growth — same as Claude Code.",
        indent + "if (!Output._charCache) Output._charCache = new Map();",
        indent + "let characters = Output._charCache.get(line);",
        indent + "if (!characters) {",
        indent + "    characters = styledCharsFromTokens(tokenize(line));",
        indent + "    Output._charCache.set(line, characters);",
        indent + "    if (Output._charCache.size > 16384) Output._charCache.clear();",
        indent + "}",
      ].join("\n");

      const crlf3 = outputContent.includes("\r\n");
      const patchedOutput = outputContent.replace(
        needle,
        crlf3 ? replacement.replace(/\n/g, "\r\n") : replacement,
      );

      if (!patchedOutput.includes("charCache")) {
        warn("[patch-ink] WARNING: charCache patch may have failed — charCache not found after replacement.");
      } else {
        fs.writeFileSync(outputJsPath, patchedOutput, "utf8");
        console.log("[patch-ink] Patched output.js — charCache tokenization memoization applied.");
      }
    }
  }
}
