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

export default renderNodeToOutput;
