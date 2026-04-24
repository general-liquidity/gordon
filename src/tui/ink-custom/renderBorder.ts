// renderBorder — paint box borders into an OutputTarget.
//
// Status: Phase 1+ (behind GORDON_CUSTOM_RENDER flag). Mirrors Ink's
// `render-border.js` but pulls border glyphs from the in-tree
// `./internal/cli-boxes.ts` table. `chalk.dim()` is used for dim border
// colors exactly as Ink does.

import chalk from "chalk";
import type Yoga from "yoga-layout";
import type { Node as YogaNode } from "yoga-layout";
import boxes, { type BoxStyle, type BoxStyleName } from "./internal/cli-boxes.ts";
import colorize from "./colorize.ts";
import type { DOMElement } from "./dom.ts";
import type { Styles } from "./styles.ts";
import type { OutputTarget } from "./outputTarget.ts";

type YogaWithBorder = YogaNode & { getComputedWidth(): number; getComputedHeight(): number };

export function renderBorder(
  x: number,
  y: number,
  node: DOMElement & { yogaNode?: YogaWithBorder },
  output: OutputTarget,
  _yoga: typeof Yoga,
): void {
  const style = node.style as Styles;
  if (!style.borderStyle || !node.yogaNode) return;

  const width = node.yogaNode.getComputedWidth();
  const height = node.yogaNode.getComputedHeight();

  const box: BoxStyle =
    typeof style.borderStyle === "string"
      ? boxes[style.borderStyle as BoxStyleName]
      : (style.borderStyle as BoxStyle);
  if (!box) return;

  const topBorderColor = style.borderTopColor ?? style.borderColor;
  const bottomBorderColor = style.borderBottomColor ?? style.borderColor;
  const leftBorderColor = style.borderLeftColor ?? style.borderColor;
  const rightBorderColor = style.borderRightColor ?? style.borderColor;
  const dimTop = style.borderTopDimColor ?? style.borderDimColor;
  const dimBottom = style.borderBottomDimColor ?? style.borderDimColor;
  const dimLeft = style.borderLeftDimColor ?? style.borderDimColor;
  const dimRight = style.borderRightDimColor ?? style.borderDimColor;

  const showTop = style.borderTop !== false;
  const showBottom = style.borderBottom !== false;
  const showLeft = style.borderLeft !== false;
  const showRight = style.borderRight !== false;
  const contentWidth = width - (showLeft ? 1 : 0) - (showRight ? 1 : 0);

  let topBorder: string | undefined = showTop
    ? colorize(
        (showLeft ? box.topLeft : "") + box.top.repeat(Math.max(0, contentWidth)) + (showRight ? box.topRight : ""),
        topBorderColor,
        "foreground",
      )
    : undefined;
  if (showTop && dimTop && topBorder) topBorder = chalk.dim(topBorder);

  let verticalHeight = height;
  if (showTop) verticalHeight -= 1;
  if (showBottom) verticalHeight -= 1;

  let leftBorder = (colorize(box.left, leftBorderColor, "foreground") + "\n").repeat(Math.max(0, verticalHeight));
  if (dimLeft) leftBorder = chalk.dim(leftBorder);

  let rightBorder = (colorize(box.right, rightBorderColor, "foreground") + "\n").repeat(Math.max(0, verticalHeight));
  if (dimRight) rightBorder = chalk.dim(rightBorder);

  let bottomBorder: string | undefined = showBottom
    ? colorize(
        (showLeft ? box.bottomLeft : "") + box.bottom.repeat(Math.max(0, contentWidth)) + (showRight ? box.bottomRight : ""),
        bottomBorderColor,
        "foreground",
      )
    : undefined;
  if (showBottom && dimBottom && bottomBorder) bottomBorder = chalk.dim(bottomBorder);

  const offsetY = showTop ? 1 : 0;
  if (topBorder) output.write(x, y, topBorder, { transformers: [] });
  if (showLeft) output.write(x, y + offsetY, leftBorder, { transformers: [] });
  if (showRight) output.write(x + width - 1, y + offsetY, rightBorder, { transformers: [] });
  if (bottomBorder) output.write(x, y + height - 1, bottomBorder, { transformers: [] });
}

export default renderBorder;
