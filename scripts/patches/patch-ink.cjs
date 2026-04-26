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

const inkPath = path.resolve(__dirname, "..", "..", "node_modules", "ink", "build", "ink.js");

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

const logUpdatePath = path.resolve(__dirname, "..", "..", "node_modules", "ink", "build", "log-update.js");

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

const outputJsPath = path.resolve(__dirname, "..", "..", "node_modules", "ink", "build", "output.js");

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

// ============================================================================
// Patch 4: DOM dirty tracking in reconciler.js (Claude Code port)
//
// Claude Code's Ink fork marks each DOM node with a `dirty` flag so the
// renderer can distinguish nodes whose content has changed from nodes that
// are identical to the previous frame ("clean").
//
// Stock Ink 6.6.0 has no such flag — every node is re-rendered unconditionally
// every frame.
//
// We patch three reconciler hooks:
//   • createInstance   — new nodes start dirty (they must be rendered at least once)
//   • commitUpdate     — when a node's props change, mark it dirty + walk ancestors
//   • commitTextUpdate — when a #text node's value changes, mark it dirty + walk ancestors
//
// The ancestor walk is required so box/root nodes know that at least one
// descendant changed and needs a render pass.
//
// This is infrastructure only: the dirty flags are consumed by Patch 5
// (render-node-to-output.js) to skip expensive squash/wrap computation for
// clean ink-text nodes.
// ============================================================================

const reconcilerPath = require("path").resolve(__dirname, "..", "..", "node_modules", "ink", "build", "reconciler.js");

if (!require("fs").existsSync(reconcilerPath)) {
  warn("[patch-ink] WARNING: reconciler.js not found at " + reconcilerPath + " — skipping dirty-tracking patch.");
} else {
  let reconcilerContent = require("fs").readFileSync(reconcilerPath, "utf8");

  if (reconcilerContent.includes("DIRTY_TRACKING")) {
    log("[patch-ink] reconciler.js already has dirty-tracking patch — skipping.");
  } else {
    const crlf4 = reconcilerContent.includes("\r\n");

    // ── createInstance: mark new nodes dirty ──────────────────────────────────
    // Target: the line that calls createNode(type), after which we inject dirty=true.
    // Actual line: "        const node = createNode(type);"
    const createInstanceNeedle = "        const node = createNode(type);";
    const createInstanceReplacement = [
      "        const node = createNode(type);",
      "        // DIRTY_TRACKING: new nodes must be rendered at least once",
      "        node.dirty = true;",
    ].join(crlf4 ? "\r\n" : "\n");

    // ── commitUpdate: mark dirty + walk ancestors when props change ───────────
    // Target: the closing brace of commitUpdate, after applyStyles call.
    // We inject after the "if (style && node.yogaNode)" block closes.
    // Actual text:
    //         if (style && node.yogaNode) {
    //             applyStyles(node.yogaNode, style);
    //         }
    //     },
    // (This is the last thing in commitUpdate before the closing brace+comma.)
    const commitUpdateNeedle = [
      "        if (style && node.yogaNode) {",
      "            applyStyles(node.yogaNode, style);",
      "        }",
      "    },",
      "    commitTextUpdate(node, _oldText, newText) {",
    ].join(crlf4 ? "\r\n" : "\n");

    const commitUpdateReplacement = [
      "        if (style && node.yogaNode) {",
      "            applyStyles(node.yogaNode, style);",
      "        }",
      "        // DIRTY_TRACKING: props changed — mark node and ancestors dirty",
      "        node.dirty = true;",
      "        let _dirtyAncestor = node.parentNode;",
      "        while (_dirtyAncestor) { _dirtyAncestor.dirty = true; _dirtyAncestor = _dirtyAncestor.parentNode; }",
      "    },",
      "    commitTextUpdate(node, _oldText, newText) {",
    ].join(crlf4 ? "\r\n" : "\n");

    // ── commitTextUpdate: mark text node + ancestors dirty ────────────────────
    // Target: the body of commitTextUpdate.
    // Actual line: "        setTextNodeValue(node, newText);"
    // We inject after this call.
    const commitTextNeedle = [
      "    commitTextUpdate(node, _oldText, newText) {",
      "        setTextNodeValue(node, newText);",
      "    },",
    ].join(crlf4 ? "\r\n" : "\n");

    const commitTextReplacement = [
      "    commitTextUpdate(node, _oldText, newText) {",
      "        setTextNodeValue(node, newText);",
      "        // DIRTY_TRACKING: text changed — mark node and ancestors dirty",
      "        node.dirty = true;",
      "        let _dirtyTextAncestor = node.parentNode;",
      "        while (_dirtyTextAncestor) { _dirtyTextAncestor.dirty = true; _dirtyTextAncestor = _dirtyTextAncestor.parentNode; }",
      "    },",
    ].join(crlf4 ? "\r\n" : "\n");

    let patched = reconcilerContent;
    let patchCount = 0;

    if (!patched.includes(createInstanceNeedle)) {
      warn("[patch-ink] WARNING: Could not find createNode(type) line in reconciler.js — createInstance dirty patch skipped.");
    } else {
      patched = patched.replace(createInstanceNeedle, createInstanceReplacement);
      patchCount++;
    }

    if (!patched.includes(commitUpdateNeedle.split(crlf4 ? "\r\n" : "\n")[0])) {
      warn("[patch-ink] WARNING: Could not find commitUpdate closing block in reconciler.js — commitUpdate dirty patch skipped.");
    } else {
      patched = patched.replace(commitUpdateNeedle, commitUpdateReplacement);
      patchCount++;
    }

    if (!patched.includes(commitTextNeedle.split(crlf4 ? "\r\n" : "\n")[0])) {
      warn("[patch-ink] WARNING: Could not find commitTextUpdate block in reconciler.js — commitTextUpdate dirty patch skipped.");
    } else {
      patched = patched.replace(commitTextNeedle, commitTextReplacement);
      patchCount++;
    }

    if (patchCount > 0) {
      require("fs").writeFileSync(reconcilerPath, patched, "utf8");
      console.log("[patch-ink] Patched reconciler.js — DOM dirty tracking applied (" + patchCount + "/3 hooks).");
    } else {
      warn("[patch-ink] WARNING: No dirty-tracking patches applied to reconciler.js — check the file manually.");
    }
  }
}

// ============================================================================
// Patch 5: Blit optimization in render-node-to-output.js (Claude Code port)
//
// Context: Ink creates a fresh Output (2D character grid) every frame, so we
// cannot skip output.write() entirely for clean nodes — doing so would leave
// those pixels blank in the new frame's grid.
//
// What we CAN skip for clean ink-text nodes is all the work that computes
// the text to write:
//   • squashTextNodes(node)     — walks the child #text nodes and concatenates
//   • widestLine(text)          — scans the string for the widest line
//   • wrapText(text, ...)       — may re-flow the entire paragraph
//   • applyPaddingToText(node)  — reads Yoga computed values + indents
//
// For a clean node (dirty === false) whose layout hasn't moved (x, y,
// maxWidth are the same as last frame), we cache the final computed text
// string in node._cachedText and reuse it directly, skipping all four calls.
//
// The cache key is: squashedText + "|" + x + "|" + y + "|" + maxWidth
// (position and width are included because a layout shift must bust the cache
// even if text content is identical).
//
// After each successful render of an ink-text node the dirty flag is cleared
// so the next frame can use the cache.  For ink-box / ink-root nodes the flag
// is also cleared after their children are processed — the subtree is clean
// going into the next frame.
//
// NOTE — true per-node blit (skipping output.write entirely) would require
// either: (a) a persistent Output object carried between frames with dirty-
// region invalidation, or (b) copying the previous frame's Output as the
// starting point for the new frame.  Neither is implemented here.  This patch
// delivers the cheaper "skip expensive computation for clean nodes" savings
// that Claude Code's fork also applies.
// ============================================================================

const renderNodePath = require("path").resolve(__dirname, "..", "..", "node_modules", "ink", "build", "render-node-to-output.js");

if (!require("fs").existsSync(renderNodePath)) {
  warn("[patch-ink] WARNING: render-node-to-output.js not found — skipping blit patch.");
} else {
  let renderContent = require("fs").readFileSync(renderNodePath, "utf8");

  if (renderContent.includes("BLIT_OPT")) {
    log("[patch-ink] render-node-to-output.js already has blit patch — skipping.");
  } else {
    const crlf5 = renderContent.includes("\r\n");
    const eol5 = crlf5 ? "\r\n" : "\n";

    // ── ink-text node: cache computed text + clear dirty after write ──────────
    // Target: the full ink-text rendering block inside renderNodeToOutput.
    //
    //         if (node.nodeName === 'ink-text') {
    //             let text = squashTextNodes(node);
    //             if (text.length > 0) {
    //                 const currentWidth = widestLine(text);
    //                 const maxWidth = getMaxWidth(yogaNode);
    //                 if (currentWidth > maxWidth) {
    //                     const textWrap = node.style.textWrap ?? 'wrap';
    //                     text = wrapText(text, maxWidth, textWrap);
    //                 }
    //                 text = applyPaddingToText(node, text);
    //                 output.write(x, y, text, { transformers: newTransformers });
    //             }
    //             return;
    //         }

    const inkTextNeedle = [
      "        if (node.nodeName === 'ink-text') {",
      "            let text = squashTextNodes(node);",
      "            if (text.length > 0) {",
      "                const currentWidth = widestLine(text);",
      "                const maxWidth = getMaxWidth(yogaNode);",
      "                if (currentWidth > maxWidth) {",
      "                    const textWrap = node.style.textWrap ?? 'wrap';",
      "                    text = wrapText(text, maxWidth, textWrap);",
      "                }",
      "                text = applyPaddingToText(node, text);",
      "                output.write(x, y, text, { transformers: newTransformers });",
      "            }",
      "            return;",
      "        }",
    ].join(eol5);

    const inkTextReplacement = [
      "        if (node.nodeName === 'ink-text') {",
      "            // BLIT_OPT: for clean nodes reuse the cached final text string,",
      "            // skipping squashTextNodes / widestLine / wrapText / applyPaddingToText.",
      "            // We still call output.write() because Output is a fresh grid each frame.",
      "            let text;",
      "            const _maxWidth = getMaxWidth(yogaNode);",
      "            const _cacheKey = x + '|' + y + '|' + _maxWidth + '|' + (node.style.textWrap ?? '');",
      "            if (!node.dirty && node._cachedText !== undefined && node._cachedRenderKey === _cacheKey) {",
      "                // Cache hit: node is clean and layout is unchanged — reuse computed text",
      "                text = node._cachedText;",
      "            } else {",
      "                // Cache miss: recompute the full text pipeline",
      "                text = squashTextNodes(node);",
      "                if (text.length > 0) {",
      "                    const currentWidth = widestLine(text);",
      "                    if (currentWidth > _maxWidth) {",
      "                        const textWrap = node.style.textWrap ?? 'wrap';",
      "                        text = wrapText(text, _maxWidth, textWrap);",
      "                    }",
      "                    text = applyPaddingToText(node, text);",
      "                }",
      "                // Store the computed text and the key that validated it",
      "                node._cachedText = text;",
      "                node._cachedRenderKey = _cacheKey;",
      "            }",
      "            if (text.length > 0) {",
      "                output.write(x, y, text, { transformers: newTransformers });",
      "            }",
      "            // Mark node clean for next frame",
      "            node.dirty = false;",
      "            return;",
      "        }",
    ].join(eol5);

    // ── ink-root / ink-box: clear dirty flag after children are processed ─────
    // Target: the block that iterates childNodes + optional unclip.
    //
    //         if (node.nodeName === 'ink-root' || node.nodeName === 'ink-box') {
    //             for (const childNode of node.childNodes) {
    //                 renderNodeToOutput(childNode, output, {
    //                     offsetX: x,
    //                     offsetY: y,
    //                     transformers: newTransformers,
    //                     skipStaticElements,
    //                 });
    //             }
    //             if (clipped) {
    //                 output.unclip();
    //             }
    //         }

    const boxRootNeedle = [
      "        if (node.nodeName === 'ink-root' || node.nodeName === 'ink-box') {",
      "            for (const childNode of node.childNodes) {",
      "                renderNodeToOutput(childNode, output, {",
      "                    offsetX: x,",
      "                    offsetY: y,",
      "                    transformers: newTransformers,",
      "                    skipStaticElements,",
      "                });",
      "            }",
      "            if (clipped) {",
      "                output.unclip();",
      "            }",
      "        }",
    ].join(eol5);

    const boxRootReplacement = [
      "        if (node.nodeName === 'ink-root' || node.nodeName === 'ink-box') {",
      "            for (const childNode of node.childNodes) {",
      "                renderNodeToOutput(childNode, output, {",
      "                    offsetX: x,",
      "                    offsetY: y,",
      "                    transformers: newTransformers,",
      "                    skipStaticElements,",
      "                });",
      "            }",
      "            if (clipped) {",
      "                output.unclip();",
      "            }",
      "            // BLIT_OPT: mark container clean after all children have been processed",
      "            node.dirty = false;",
      "        }",
    ].join(eol5);

    let renderPatched = renderContent;
    let renderPatchCount = 0;

    if (!renderPatched.includes(inkTextNeedle.split(eol5)[0])) {
      warn("[patch-ink] WARNING: Could not find ink-text block in render-node-to-output.js — ink-text blit patch skipped.");
    } else {
      renderPatched = renderPatched.replace(inkTextNeedle, inkTextReplacement);
      renderPatchCount++;
    }

    if (!renderPatched.includes(boxRootNeedle.split(eol5)[0])) {
      warn("[patch-ink] WARNING: Could not find ink-root/ink-box block in render-node-to-output.js — box dirty-clear patch skipped.");
    } else {
      renderPatched = renderPatched.replace(boxRootNeedle, boxRootReplacement);
      renderPatchCount++;
    }

    if (renderPatchCount > 0) {
      require("fs").writeFileSync(renderNodePath, renderPatched, "utf8");
      console.log("[patch-ink] Patched render-node-to-output.js — blit optimization applied (" + renderPatchCount + "/2 sites).");
    } else {
      warn("[patch-ink] WARNING: No blit patches applied to render-node-to-output.js — check the file manually.");
    }
  }
}

// ============================================================================
// Patch 6: CLEAR_INCREMENTAL_CACHE — global hook to reset incremental render
//          state in log-update.js (createIncremental)
//
// Problem: incrementalRendering: true conflicts with ScrollBox's marginTop
// scroll mechanism. When scrollTop changes, all rendered line positions shift
// simultaneously. Ink's line-diff compares the new frame against the previous
// frame's line array, which now misaligns by scrollTop rows — writing content
// to wrong terminal rows (text bleed).
//
// Fix: Expose global.__inkClearIncrementalOutput() from inside createIncremental
// so ScrollBox can call it whenever scrollTop changes, forcing a full repaint
// for that scroll frame (resetting previousLines and previousOutput to empty).
// Normal (non-scroll) frames still benefit from the incremental line-diff.
//
// Target: inside createIncremental, after the `let previousOutput = '';` and
//         `let hasHiddenCursor = false;` declarations.
// Insert: global.__inkClearIncrementalOutput setter that resets previousLines
//         and previousOutput to their initial empty values.
// ============================================================================

const logUpdatePath6 = require("path").resolve(__dirname, "..", "..", "node_modules", "ink", "build", "log-update.js");

if (!require("fs").existsSync(logUpdatePath6)) {
  warn("[patch-ink] WARNING: log-update.js not found at " + logUpdatePath6 + " — skipping CLEAR_INCREMENTAL_CACHE patch.");
} else {
  let logUpdate6Content = require("fs").readFileSync(logUpdatePath6, "utf8");

  // Idempotency check
  if (logUpdate6Content.includes("CLEAR_INCREMENTAL_CACHE")) {
    log("[patch-ink] log-update.js already has CLEAR_INCREMENTAL_CACHE patch — skipping.");
  } else {
    const crlf6 = logUpdate6Content.includes("\r\n");
    const eol6 = crlf6 ? "\r\n" : "\n";

    // Needle: the three variable declarations that open createIncremental's closure.
    // These are guaranteed to be present (and unique) in stock Ink 6.x log-update.js.
    const needle6 = [
      "    let previousLines = [];",
      "    let previousOutput = '';",
      "    let hasHiddenCursor = false;",
    ].join(eol6);

    const replacement6 = [
      "    let previousLines = [];",
      "    let previousOutput = '';",
      "    let hasHiddenCursor = false;",
      "    // CLEAR_INCREMENTAL_CACHE: allow external callers (e.g. ScrollBox) to reset",
      "    // the incremental line-diff state so the next frame does a full repaint.",
      "    // Called whenever marginTop shifts so the line-diff doesn't misalign rows.",
      "    global.__inkClearIncrementalOutput = () => { previousLines = []; previousOutput = ''; };",
    ].join(eol6);

    if (!logUpdate6Content.includes(needle6)) {
      warn("[patch-ink] WARNING: Could not find previousLines/previousOutput/hasHiddenCursor declarations in createIncremental (log-update.js).");
      warn("[patch-ink] The file may have been updated — inspect node_modules/ink/build/log-update.js manually.");
    } else {
      const patched6 = logUpdate6Content.replace(needle6, replacement6);
      require("fs").writeFileSync(logUpdatePath6, patched6, "utf8");
      console.log("[patch-ink] Patched log-update.js — CLEAR_INCREMENTAL_CACHE global hook applied.");
    }
  }
}

// ============================================================================
// Patch 7: YOGA_MEASURE_REGISTRY — global Yoga node registry in reconciler.js
//
// After each render cycle the virtual scroll system needs the actual Yoga-
// computed height of each visible message Box so it can correct the heuristic
// height estimates held in heightCache.  Stock Ink exposes no public API for
// this, but every ink-box DOM node carries a `yogaNode` reference whose
// `getComputedHeight()` method returns the final layout value.
//
// We instrument three reconciler hooks to maintain a global registry that maps
// an arbitrary string ID (passed via the `data-measure-id` prop) to its Ink
// DOM node:
//
//   createInstance  — register node when it is first created with the prop
//   commitUpdate    — update registration when the prop changes value
//   removeChild /
//   removeChildFromContainer — clean up when the node is unmounted
//
// We also install two global helpers at module load time:
//
//   global.__inkNodeRegistry        — the Map<id, node> registry itself
//   global.__inkGetMeasuredHeight   — function(id) → number | null
//
// VirtualMessageList.tsx passes `data-measure-id={msg.id}` on each visible
// Box wrapper and calls __inkGetMeasuredHeight from a post-render useEffect.
//
// Idempotency sentinel: YOGA_MEASURE_REGISTRY
// ============================================================================

const reconcilerPath7 = require("path").resolve(__dirname, "..", "..", "node_modules", "ink", "build", "reconciler.js");

if (!require("fs").existsSync(reconcilerPath7)) {
  warn("[patch-ink] WARNING: reconciler.js not found — skipping YOGA_MEASURE_REGISTRY patch.");
} else {
  let rec7Content = require("fs").readFileSync(reconcilerPath7, "utf8");

  if (rec7Content.includes("YOGA_MEASURE_REGISTRY")) {
    log("[patch-ink] reconciler.js already has YOGA_MEASURE_REGISTRY patch — skipping.");
  } else {
    const crlf7 = rec7Content.includes("\r\n");
    const eol7 = crlf7 ? "\r\n" : "\n";

    // ── Global registry + helper — injected once at module level ─────────────
    // Target: the very first line of the file (the process import), so we
    // prepend the registry setup before any reconciler code runs.
    // We locate the import statement as a safe unique anchor.
    const globalRegistryBlock = [
      "// YOGA_MEASURE_REGISTRY: global Yoga node registry for virtual-scroll height feedback (patch-ink.cjs)",
      "global.__inkNodeRegistry = global.__inkNodeRegistry || {};",
      "global.__inkGetMeasuredHeight = function(id) {",
      "  var node = global.__inkNodeRegistry && global.__inkNodeRegistry[id];",
      "  if (!node || !node.yogaNode) return null;",
      "  try { return node.yogaNode.getComputedHeight(); } catch (e) { return null; }",
      "};",
    ].join(eol7);

    const importLine = "import process from 'node:process';";
    if (!rec7Content.includes(importLine)) {
      warn("[patch-ink] WARNING: Could not find 'import process' in reconciler.js — YOGA_MEASURE_REGISTRY global block skipped.");
    } else {
      rec7Content = rec7Content.replace(
        importLine,
        importLine + eol7 + globalRegistryBlock,
      );
    }

    // ── createInstance: register node when data-measure-id prop is present ───
    // Target: the closing `return node;` of createInstance.
    // The DIRTY_TRACKING patch (Patch 4) already added `node.dirty = true;`
    // before the closing `return node;`, so our anchor is the final two lines
    // of the createInstance body that exist after all prop loops.
    //
    // Actual lines (after Patch 4 has run):
    //         setAttribute(node, key, value);
    //     }
    // }
    // return node;
    // },
    // createTextInstance
    //
    // We target the `return node;\n    },\n    createTextInstance` sequence.
    const createInstanceReturnNeedle = [
      "        return node;",
      "    },",
      "    createTextInstance(text, _root, hostContext) {",
    ].join(eol7);

    const createInstanceReturnReplacement = [
      "        // YOGA_MEASURE_REGISTRY: register node when data-measure-id prop is present",
      "        if (newProps['data-measure-id'] != null) {",
      "            global.__inkNodeRegistry[newProps['data-measure-id']] = node;",
      "        }",
      "        return node;",
      "    },",
      "    createTextInstance(text, _root, hostContext) {",
    ].join(eol7);

    if (!rec7Content.includes(createInstanceReturnNeedle)) {
      warn("[patch-ink] WARNING: Could not find createInstance return in reconciler.js — createInstance registry patch skipped.");
    } else {
      rec7Content = rec7Content.replace(createInstanceReturnNeedle, createInstanceReturnReplacement);
    }

    // ── commitUpdate: update registry when data-measure-id changes ───────────
    // Target: the DIRTY_TRACKING block at the end of commitUpdate, specifically
    // the ancestor-walk line followed by `},\n    commitTextUpdate`.
    //
    // Actual lines (after Patch 4):
    //         node.dirty = true;
    //         let _dirtyAncestor = node.parentNode;
    //         while (_dirtyAncestor) { _dirtyAncestor.dirty = true; _dirtyAncestor = _dirtyAncestor.parentNode; }
    //     },
    //     commitTextUpdate(node, _oldText, newText) {
    const commitUpdateDirtyNeedle = [
      "        // DIRTY_TRACKING: props changed — mark node and ancestors dirty",
      "        node.dirty = true;",
      "        let _dirtyAncestor = node.parentNode;",
      "        while (_dirtyAncestor) { _dirtyAncestor.dirty = true; _dirtyAncestor = _dirtyAncestor.parentNode; }",
      "    },",
      "    commitTextUpdate(node, _oldText, newText) {",
    ].join(eol7);

    const commitUpdateDirtyReplacement = [
      "        // DIRTY_TRACKING: props changed — mark node and ancestors dirty",
      "        node.dirty = true;",
      "        let _dirtyAncestor = node.parentNode;",
      "        while (_dirtyAncestor) { _dirtyAncestor.dirty = true; _dirtyAncestor = _dirtyAncestor.parentNode; }",
      "        // YOGA_MEASURE_REGISTRY: keep registry in sync when data-measure-id changes",
      "        if (newProps['data-measure-id'] != null) {",
      "            global.__inkNodeRegistry[newProps['data-measure-id']] = node;",
      "        } else if (oldProps['data-measure-id'] != null) {",
      "            delete global.__inkNodeRegistry[oldProps['data-measure-id']];",
      "        }",
      "    },",
      "    commitTextUpdate(node, _oldText, newText) {",
    ].join(eol7);

    if (!rec7Content.includes(commitUpdateDirtyNeedle)) {
      warn("[patch-ink] WARNING: Could not find DIRTY_TRACKING block in commitUpdate (reconciler.js) — commitUpdate registry patch skipped.");
    } else {
      rec7Content = rec7Content.replace(commitUpdateDirtyNeedle, commitUpdateDirtyReplacement);
    }

    // ── removeChild: clean up registry on unmount ────────────────────────────
    // Target: the removeChild handler body.
    //     removeChild(node, removeNode) {
    //         removeChildNode(node, removeNode);
    //         cleanupYogaNode(removeNode.yogaNode);
    //     },
    const removeChildNeedle = [
      "    removeChild(node, removeNode) {",
      "        removeChildNode(node, removeNode);",
      "        cleanupYogaNode(removeNode.yogaNode);",
      "    },",
    ].join(eol7);

    const removeChildReplacement = [
      "    removeChild(node, removeNode) {",
      "        removeChildNode(node, removeNode);",
      "        cleanupYogaNode(removeNode.yogaNode);",
      "        // YOGA_MEASURE_REGISTRY: remove from registry on unmount",
      "        if (removeNode['data-measure-id'] != null) {",
      "            delete global.__inkNodeRegistry[removeNode['data-measure-id']];",
      "        }",
      "    },",
    ].join(eol7);

    if (!rec7Content.includes(removeChildNeedle)) {
      warn("[patch-ink] WARNING: Could not find removeChild block in reconciler.js — removeChild registry patch skipped.");
    } else {
      rec7Content = rec7Content.replace(removeChildNeedle, removeChildReplacement);
    }

    // ── removeChildFromContainer: same cleanup for root-level removal ─────────
    //     removeChildFromContainer(node, removeNode) {
    //         removeChildNode(node, removeNode);
    //         cleanupYogaNode(removeNode.yogaNode);
    //     },
    const removeFromContainerNeedle = [
      "    removeChildFromContainer(node, removeNode) {",
      "        removeChildNode(node, removeNode);",
      "        cleanupYogaNode(removeNode.yogaNode);",
      "    },",
    ].join(eol7);

    const removeFromContainerReplacement = [
      "    removeChildFromContainer(node, removeNode) {",
      "        removeChildNode(node, removeNode);",
      "        cleanupYogaNode(removeNode.yogaNode);",
      "        // YOGA_MEASURE_REGISTRY: remove from registry on container unmount",
      "        if (removeNode['data-measure-id'] != null) {",
      "            delete global.__inkNodeRegistry[removeNode['data-measure-id']];",
      "        }",
      "    },",
    ].join(eol7);

    if (!rec7Content.includes(removeFromContainerNeedle)) {
      warn("[patch-ink] WARNING: Could not find removeChildFromContainer block in reconciler.js — removeChildFromContainer registry patch skipped.");
    } else {
      rec7Content = rec7Content.replace(removeFromContainerNeedle, removeFromContainerReplacement);
    }

    require("fs").writeFileSync(reconcilerPath7, rec7Content, "utf8");
    console.log("[patch-ink] Patched reconciler.js — YOGA_MEASURE_REGISTRY global node registry applied.");
  }
}
