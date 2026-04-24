// Static — Phase 0 re-export shim.
//
// Delegates to `ink`'s Static component. Gordon uses this for the boot card
// and for committed chat history that scrolls out of the live region. In
// Phase 1 the implementation will be rewritten to push its output straight
// to stdout above the live paint region (same semantic as ink, but without
// the react-reconciler detour).

import { Static, type StaticProps } from "ink";

// Re-export the type via a parametric alias so consumers using
// `import { type StaticProps } from '.../ink-custom'` keep working.
export type Props<T> = StaticProps<T>;
export default Static;
