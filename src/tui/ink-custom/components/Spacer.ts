// Spacer — Phase 0 re-export shim.
//
// Spacer is a <Box flexGrow={1} />. In Phase 1 this becomes a pure alias
// that doesn't go through the reconciler at all; for now we re-export ink's
// implementation so behavior is identical.

import { Spacer } from "ink";
export default Spacer;
