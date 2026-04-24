// Box — Phase 0 re-export shim.
//
// Delegates to `ink`'s Box component. In Phase 1 this is replaced by a
// direct ink-custom reconciler host element (the "ink-box" node name used
// in dom.ts). The Props type is re-exported from ink because Gordon's
// components consume it via `import { type BoxProps } from 'ink'`.
//
// Future (Phase 1):
//   - Own the Props type here (decouple from ink's generated d.ts).
//   - Emit ink-box DOM elements via this module's createElement shim.

import { Box, type BoxProps } from "ink";
export type Props = BoxProps;
export default Box;
