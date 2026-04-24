// styles — Phase 0 vendored type surface.
//
// The `Styles` type enumerates every CSS-like property Gordon's Box/Text
// consume: flex layout, margin/padding, border, color, overflow, etc.
//
// In Phase 0 we vendor the TYPES (no runtime behavior) so callers using
// `import { type Styles } from '.../ink-custom'` work. Phase 2 replaces
// this with a custom layout engine and owns the mapping of Styles ->
// cell-grid metrics directly.

import type { ForegroundColorName } from "ansi-styles";
import type { Boxes, BoxStyle } from "cli-boxes";
import type { LiteralUnion } from "type-fest";

export type Styles = {
  readonly textWrap?:
    | "wrap"
    | "end"
    | "middle"
    | "truncate-end"
    | "truncate"
    | "truncate-middle"
    | "truncate-start";

  readonly position?: "absolute" | "relative";

  readonly columnGap?: number;
  readonly rowGap?: number;
  readonly gap?: number;

  readonly margin?: number;
  readonly marginX?: number;
  readonly marginY?: number;
  readonly marginTop?: number;
  readonly marginBottom?: number;
  readonly marginLeft?: number;
  readonly marginRight?: number;

  readonly padding?: number;
  readonly paddingX?: number;
  readonly paddingY?: number;
  readonly paddingTop?: number;
  readonly paddingBottom?: number;
  readonly paddingLeft?: number;
  readonly paddingRight?: number;

  readonly flexGrow?: number;
  readonly flexShrink?: number;
  readonly flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  readonly flexBasis?: number | string;
  readonly flexWrap?: "nowrap" | "wrap" | "wrap-reverse";

  readonly alignItems?: "flex-start" | "center" | "flex-end" | "stretch";
  readonly alignSelf?: "flex-start" | "center" | "flex-end" | "auto";
  readonly justifyContent?:
    | "flex-start"
    | "flex-end"
    | "space-between"
    | "space-around"
    | "space-evenly"
    | "center";

  readonly width?: number | string;
  readonly height?: number | string;
  readonly minWidth?: number | string;
  readonly minHeight?: number | string;

  readonly display?: "flex" | "none";

  readonly borderStyle?: keyof Boxes | BoxStyle;
  readonly borderTop?: boolean;
  readonly borderBottom?: boolean;
  readonly borderLeft?: boolean;
  readonly borderRight?: boolean;
  readonly borderColor?: LiteralUnion<ForegroundColorName, string>;
  readonly borderTopColor?: LiteralUnion<ForegroundColorName, string>;
  readonly borderBottomColor?: LiteralUnion<ForegroundColorName, string>;
  readonly borderLeftColor?: LiteralUnion<ForegroundColorName, string>;
  readonly borderRightColor?: LiteralUnion<ForegroundColorName, string>;
  readonly borderDimColor?: boolean;
  readonly borderTopDimColor?: boolean;
  readonly borderBottomDimColor?: boolean;
  readonly borderLeftDimColor?: boolean;
  readonly borderRightDimColor?: boolean;

  readonly overflow?: "visible" | "hidden";
  readonly overflowX?: "visible" | "hidden";
  readonly overflowY?: "visible" | "hidden";

  readonly backgroundColor?: LiteralUnion<ForegroundColorName, string>;
};
