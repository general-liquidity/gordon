// dom — Phase 0 vendored type surface + runtime shim.
//
// Ink represents the rendered tree as a small DOM-like structure:
//   - ink-root, ink-box, ink-text, ink-virtual-text (plus #text leaves).
//   - Each non-text node owns a Yoga node for layout.
//
// In Phase 0 we vendor the TYPES so Phase 1+ can evolve the node shape
// without breaking consumers. The runtime factories (createNode,
// appendChildNode, etc.) are NOT re-exported from this module because
// Gordon doesn't call them directly — they are internal to the reconciler,
// which lives in ink's build output. Phase 1 will add owned factories here.

import type { Node as YogaNode } from "yoga-layout";
import type { Styles } from "./styles.ts";

export type TextName = "#text";
export type ElementNames = "ink-root" | "ink-box" | "ink-text" | "ink-virtual-text";
export type NodeNames = ElementNames | TextName;

export type DOMNodeAttribute = boolean | string | number;

type InkNode = {
  parentNode: DOMElement | undefined;
  yogaNode?: YogaNode;
  internal_static?: boolean;
  style: Styles;
};

export type DOMElement = {
  nodeName: ElementNames;
  attributes: Record<string, DOMNodeAttribute>;
  childNodes: DOMNode[];
  internal_transform?: (input: string, index: number) => string;
  internal_accessibility?: {
    role?:
      | "button"
      | "checkbox"
      | "combobox"
      | "list"
      | "listbox"
      | "listitem"
      | "menu"
      | "menuitem"
      | "option"
      | "progressbar"
      | "radio"
      | "radiogroup"
      | "tab"
      | "tablist"
      | "table"
      | "textbox"
      | "timer"
      | "toolbar";
    state?: {
      busy?: boolean;
      checked?: boolean;
      disabled?: boolean;
      expanded?: boolean;
      multiline?: boolean;
      multiselectable?: boolean;
      readonly?: boolean;
      required?: boolean;
      selected?: boolean;
    };
  };
  isStaticDirty?: boolean;
  staticNode?: DOMElement;
  onComputeLayout?: () => void;
  onRender?: () => void;
  onImmediateRender?: () => void;
} & InkNode;

export type TextNode = {
  nodeName: TextName;
  nodeValue: string;
} & InkNode;

export type DOMNode<T extends { nodeName: NodeNames } = { nodeName: NodeNames }> = T extends {
  nodeName: infer U;
}
  ? U extends "#text"
    ? TextNode
    : DOMElement
  : never;
