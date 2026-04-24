// renderBackground — paint a box's backgroundColor into an OutputTarget.
//
// Status: Phase 1+ (behind GORDON_CUSTOM_RENDER flag). Mirrors Ink's
// `render-background.js`. The background fills only the content area
// (inside borders), so border cells remain their own foreground color.

import type { Node as YogaNode } from "yoga-layout";
import colorize from "./colorize.ts";
import type { DOMElement } from "./dom.ts";
import type { Styles } from "./styles.ts";
import type { OutputTarget } from "./outputTarget.ts";

type YogaSized = YogaNode & { getComputedWidth(): number; getComputedHeight(): number };

export function renderBackground(
  x: number,
  y: number,
  node: DOMElement & { yogaNode?: YogaSized },
  output: OutputTarget,
): void {
  const style = node.style as Styles;
  if (!style.backgroundColor || !node.yogaNode) return;

  const width = node.yogaNode.getComputedWidth();
  const height = node.yogaNode.getComputedHeight();

  const leftBorder = style.borderStyle && style.borderLeft !== false ? 1 : 0;
  const rightBorder = style.borderStyle && style.borderRight !== false ? 1 : 0;
  const topBorder = style.borderStyle && style.borderTop !== false ? 1 : 0;
  const bottomBorder = style.borderStyle && style.borderBottom !== false ? 1 : 0;
  const contentWidth = width - leftBorder - rightBorder;
  const contentHeight = height - topBorder - bottomBorder;

  if (!(contentWidth > 0 && contentHeight > 0)) return;

  const backgroundLine = colorize(" ".repeat(contentWidth), style.backgroundColor, "background");
  for (let row = 0; row < contentHeight; row++) {
    output.write(x + leftBorder, y + topBorder + row, backgroundLine, { transformers: [] });
  }
}

export default renderBackground;
