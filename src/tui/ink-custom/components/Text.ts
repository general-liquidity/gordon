// Text — Phase 0 re-export shim.
//
// Delegates to `ink`'s Text component. In Phase 1 this is replaced by a
// direct ink-custom reconciler host element (the "ink-text" node name used
// in dom.ts). Styling (bold, italic, color, dimColor, ...) will be applied
// via chalk in a dedicated `apply-styles.ts` module.

import { Text, type TextProps } from "ink";
export type Props = TextProps;
export default Text;
