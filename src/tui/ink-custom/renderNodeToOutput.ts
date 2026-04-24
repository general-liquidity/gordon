// renderNodeToOutput — walks a laid-out DOM tree and paints into an OutputTarget.
//
// Status: Phase 1+ (behind GORDON_CUSTOM_RENDER flag). Mirrors Ink's
// `render-node-to-output.js` but against the vendored `DOMElement` type and
// our OutputTarget (CellBuffer-backed when the full pipeline is active,
// ANSI-string-backed when falling back).

import Yoga from "yoga-layout";
import widestLine from "widest-line";
import indentString from "indent-string";
import type { DOMElement, TextNode } from "./dom.ts";
import type { Styles } from "./styles.ts";
import type { OutputTarget } from "./outputTarget.ts";
import { createOutputTarget } from "./outputTarget.ts";
import { squashTextNodes } from "./domRuntime.ts";
import renderBackground from "./renderBackground.ts";
import renderBorder from "./renderBorder.ts";
import wrapAnsi from "wrap-ansi";
import cliTruncate from "cli-truncate";

// ============================================================================
// Layout helpers
// ============================================================================

function getMaxWidth(yogaNode: ReturnType<typeof Yoga.Node.create>): number {
  return (
    yogaNode.getComputedWidth() -
    yogaNode.getComputedPadding(Yoga.EDGE_LEFT) -
    yogaNode.getComputedPadding(Yoga.EDGE_RIGHT) -
    yogaNode.getComputedBorder(Yoga.EDGE_LEFT) -
    yogaNode.getComputedBorder(Yoga.EDGE_RIGHT)
  );
}

function wrapText(text: string, maxWidth: number, wrapType: string): string {
  if (wrapType === "wrap") {
    return wrapAnsi(text, maxWidth, { trim: false, hard: true });
  }
  if (wrapType.startsWith("truncate")) {
    let position: "start" | "middle" | "end" = "end";
    if (wrapType === "truncate-middle") position = "middle";
    if (wrapType === "truncate-start") position = "start";
    return cliTruncate(text, maxWidth, { position });
  }
  return text;
}

function applyPaddingToText(node: DOMElement, text: string): string {
  const child = node.childNodes[0];
  if (!child) return text;
  const yogaNode = (child as { yogaNode?: ReturnType<typeof Yoga.Node.create> }).yogaNode;
  if (!yogaNode) return text;
  const offsetX = yogaNode.getComputedLeft();
  const offsetY = yogaNode.getComputedTop();
  return "\n".repeat(offsetY) + indentString(text, offsetX);
}

// ============================================================================
// Main walker
// ============================================================================

export interface RenderOptions {
  offsetX?: number;
  offsetY?: number;
  transformers?: Array<(s: string, index: number) => string>;
  skipStaticElements: boolean;
}

export function renderNodeToOutput(
  node: DOMElement,
  output: OutputTarget,
  options: RenderOptions,
): void {
  const { offsetX = 0, offsetY = 0, transformers = [], skipStaticElements } = options;

  if (skipStaticElements && node.internal_static) return;

  const yogaNode = node.yogaNode;
  if (!yogaNode) return;

  if (yogaNode.getDisplay() === Yoga.DISPLAY_NONE) return;

  const x = offsetX + yogaNode.getComputedLeft();
  const y = offsetY + yogaNode.getComputedTop();

  let newTransformers = transformers;
  if (typeof node.internal_transform === "function") {
    newTransformers = [node.internal_transform, ...transformers];
  }

  if (node.nodeName === "ink-text") {
    let text = squashTextNodes(node);
    if (text.length > 0) {
      const maxWidth = getMaxWidth(yogaNode);
      const currentWidth = widestLine(text);
      if (currentWidth > maxWidth) {
        const wrapType = (node.style as Styles).textWrap ?? "wrap";
        text = wrapText(text, maxWidth, wrapType);
      }
      text = applyPaddingToText(node, text);
    }
    if (text.length > 0) {
      output.write(x, y, text, { transformers: newTransformers });
    }
    return;
  }

  let clipped = false;
  if (node.nodeName === "ink-box") {
    renderBackground(x, y, node, output);
    renderBorder(x, y, node, output, Yoga);
    const style = node.style as Styles;
    const clipH = style.overflowX === "hidden" || style.overflow === "hidden";
    const clipV = style.overflowY === "hidden" || style.overflow === "hidden";
    if (clipH || clipV) {
      const x1 = clipH ? x + yogaNode.getComputedBorder(Yoga.EDGE_LEFT) : undefined;
      const x2 = clipH
        ? x + yogaNode.getComputedWidth() - yogaNode.getComputedBorder(Yoga.EDGE_RIGHT)
        : undefined;
      const y1 = clipV ? y + yogaNode.getComputedBorder(Yoga.EDGE_TOP) : undefined;
      const y2 = clipV
        ? y + yogaNode.getComputedHeight() - yogaNode.getComputedBorder(Yoga.EDGE_BOTTOM)
        : undefined;
      output.clip({ x1, x2, y1, y2 });
      clipped = true;
    }
  }

  if (node.nodeName === "ink-root" || node.nodeName === "ink-box") {
    for (const child of node.childNodes) {
      if (child.nodeName === "#text") {
        // Stray text under a box is illegal per Ink's reconciler, skip.
        continue;
      }
      renderNodeToOutput(child as DOMElement, output, {
        offsetX: x,
        offsetY: y,
        transformers: newTransformers,
        skipStaticElements,
      });
    }
    if (clipped) output.unclip();
  }
  // Silence unused-variable lint for TextNode type import.
  void (null as TextNode | null);
}

/**
 * Render the `<Static>` subtree (rootNode.staticNode) to a plain ANSI
 * string. Mirrors ink's renderer.js staticOutput branch:
 *   - Fresh OutputTarget sized to the staticNode's computed dimensions.
 *   - Walk the staticNode subtree with skipStaticElements=false so the
 *     static-marked children actually paint.
 *   - Return toAnsiString() — no cell-buffer, no pools, no diff.
 *
 * Returns `""` if rootNode has no staticNode, or the staticNode has no
 * yogaNode / zero dimensions. The caller treats empty as "nothing new to
 * scroll into history this render."
 *
 * This is called alongside the main-frame render; the reconciler's
 * `Static` component only emits items that haven't been rendered yet,
 * so the returned ANSI is already the "new-items delta" for this tick.
 */
export function renderStaticNodeToAnsi(rootNode: DOMElement): string {
  const staticNode = rootNode.staticNode;
  if (!staticNode) return "";
  const yogaNode = staticNode.yogaNode;
  if (!yogaNode) return "";
  // Empty children → nothing to emit. Short-circuit before we allocate a
  // grid and paint blank rows that would still tokenize as "\n"-joined
  // whitespace (which the caller would misinterpret as a non-empty delta).
  if (staticNode.childNodes.length === 0) return "";

  const width = Math.max(1, yogaNode.getComputedWidth());
  const height = Math.max(1, yogaNode.getComputedHeight());

  const output = createOutputTarget(width, height);
  renderNodeToOutput(staticNode, output, { skipStaticElements: false });
  const ansi = output.toAnsiString();

  // toAnsiString() produces one entry per row joined with "\n"; rows with
  // no painted content rstrip to "". Strip trailing empty rows so the
  // caller can treat an empty-string result as "no delta" without having
  // to parse the grid. An all-blank result becomes "".
  const trimmed = ansi.replace(/\n+$/u, "");
  if (trimmed.length === 0) return "";
  return trimmed;
}

export default renderNodeToOutput;
