// measureElement — Phase 0 re-export shim.
//
// Reads computed layout from a DOMElement ref. Gordon uses this in a handful
// of components (e.g. VirtualMessageList) to react to measured sizes. In
// Phase 2 (custom layout engine), this reads from the cell-grid layout pass
// instead of Yoga.

import { measureElement } from "ink";
import type { DOMElement } from "./dom.ts";

export type MeasureOutput = {
  width: number;
  height: number;
};

const measure = (node: DOMElement): MeasureOutput => {
  // ink's measureElement expects its own DOMElement type; Phase 0's DOMElement
  // is structurally compatible (vendored from ink's d.ts).
  return measureElement(node as never);
};

export default measure;
