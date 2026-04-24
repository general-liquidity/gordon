// domRuntime — runtime DOM factories for the custom reconciler.
//
// Status: Phase 1+ (behind GORDON_CUSTOM_RENDER flag). Mirrors Ink's
// `dom.ts` runtime (createNode, appendChildNode, ...) but targets the
// vendored DOM types in `./dom.ts`.
//
// Kept separate from `dom.ts` (which is a Phase-0 type-only surface) so the
// flag-off code path never imports this file.

import Yoga from "yoga-layout";
import type { Node as YogaNode } from "yoga-layout";
import widestLine from "widest-line";
import wrapAnsi from "wrap-ansi";
import cliTruncate from "cli-truncate";
import type { DOMElement, DOMNodeAttribute, ElementNames, NodeNames, TextNode } from "./dom.ts";
import type { Styles } from "./styles.ts";

// ============================================================================
// Internal measurement helpers (kept self-contained for flag-off safety)
// ============================================================================

type Dimensions = { width: number; height: number };
const measureCache = new Map<string, Dimensions>();

function measureText(text: string): Dimensions {
  if (text.length === 0) return { width: 0, height: 0 };
  const cached = measureCache.get(text);
  if (cached) return cached;
  const dim: Dimensions = { width: widestLine(text), height: text.split("\n").length };
  measureCache.set(text, dim);
  if (measureCache.size > 4096) measureCache.clear();
  return dim;
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

export function squashTextNodes(node: DOMElement): string {
  let text = "";
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (!child) continue;
    let nodeText = "";
    if (child.nodeName === "#text") {
      nodeText = (child as TextNode).nodeValue;
    } else {
      const childElement = child as DOMElement;
      if (childElement.nodeName === "ink-text" || childElement.nodeName === "ink-virtual-text") {
        nodeText = squashTextNodes(childElement);
      }
      if (nodeText.length > 0 && typeof childElement.internal_transform === "function") {
        nodeText = childElement.internal_transform(nodeText, i);
      }
    }
    text += nodeText;
  }
  return text;
}

// ============================================================================
// Node factories
// ============================================================================

export function createNode(nodeName: ElementNames): DOMElement {
  const node: DOMElement = {
    nodeName,
    style: {},
    attributes: {},
    childNodes: [],
    parentNode: undefined,
    yogaNode: nodeName === "ink-virtual-text" ? undefined : Yoga.Node.create(),
    internal_accessibility: {},
  };

  if (nodeName === "ink-text" && node.yogaNode) {
    node.yogaNode.setMeasureFunc((width) => measureTextNode(node, width));
  }
  return node;
}

export function createTextNode(text: string): TextNode {
  const node: TextNode = {
    nodeName: "#text",
    nodeValue: text,
    yogaNode: undefined,
    parentNode: undefined,
    style: {},
  };
  setTextNodeValue(node, text);
  return node;
}

function measureTextNode(node: DOMElement, width: number): Dimensions {
  const text = node.nodeName === ("#text" as NodeNames) ? "" : squashTextNodes(node);
  const dim = measureText(text);
  if (dim.width <= width) return dim;
  if (dim.width >= 1 && width > 0 && width < 1) return dim;
  const wrapType = (node.style as Styles).textWrap ?? "wrap";
  const wrapped = wrapText(text, width, wrapType);
  return measureText(wrapped);
}

function findClosestYogaNode(node: DOMElement | TextNode | undefined): YogaNode | undefined {
  if (!node?.parentNode) return undefined;
  const own = (node as { yogaNode?: YogaNode }).yogaNode;
  return own ?? findClosestYogaNode(node.parentNode);
}

function markNodeAsDirty(node: DOMElement | TextNode): void {
  const yogaNode = findClosestYogaNode(node);
  yogaNode?.markDirty();
}

export function setTextNodeValue(node: TextNode, text: string): void {
  const coerced = typeof text !== "string" ? String(text) : text;
  node.nodeValue = coerced;
  markNodeAsDirty(node);
}

export function setAttribute(node: DOMElement, key: string, value: DOMNodeAttribute): void {
  if (key === "internal_accessibility") {
    node.internal_accessibility = value as unknown as DOMElement["internal_accessibility"];
    return;
  }
  node.attributes[key] = value;
}

export function setStyle(node: DOMElement, style: Styles): void {
  node.style = style;
}

export function appendChildNode(node: DOMElement, childNode: DOMElement | TextNode): void {
  if (childNode.parentNode) {
    removeChildNode(childNode.parentNode, childNode);
  }
  childNode.parentNode = node;
  node.childNodes.push(childNode);
  const childYoga = (childNode as { yogaNode?: YogaNode }).yogaNode;
  if (childYoga && node.yogaNode) {
    node.yogaNode.insertChild(childYoga, node.yogaNode.getChildCount());
  }
  if (node.nodeName === "ink-text" || node.nodeName === "ink-virtual-text") {
    markNodeAsDirty(node);
  }
}

export function insertBeforeNode(
  node: DOMElement,
  newChildNode: DOMElement | TextNode,
  beforeChildNode: DOMElement | TextNode,
): void {
  if (newChildNode.parentNode) {
    removeChildNode(newChildNode.parentNode, newChildNode);
  }
  newChildNode.parentNode = node;
  const index = node.childNodes.indexOf(beforeChildNode as DOMElement);
  const childYoga = (newChildNode as { yogaNode?: YogaNode }).yogaNode;
  if (index >= 0) {
    node.childNodes.splice(index, 0, newChildNode as DOMElement);
    if (childYoga && node.yogaNode) {
      node.yogaNode.insertChild(childYoga, index);
    }
    return;
  }
  node.childNodes.push(newChildNode as DOMElement);
  if (childYoga && node.yogaNode) {
    node.yogaNode.insertChild(childYoga, node.yogaNode.getChildCount());
  }
  if (node.nodeName === "ink-text" || node.nodeName === "ink-virtual-text") {
    markNodeAsDirty(node);
  }
}

export function removeChildNode(node: DOMElement, removeNode: DOMElement | TextNode): void {
  const removeYoga = (removeNode as { yogaNode?: YogaNode }).yogaNode;
  if (removeYoga) {
    removeNode.parentNode?.yogaNode?.removeChild(removeYoga);
  }
  removeNode.parentNode = undefined;
  const idx = node.childNodes.indexOf(removeNode as DOMElement);
  if (idx >= 0) {
    node.childNodes.splice(idx, 1);
  }
  if (node.nodeName === "ink-text" || node.nodeName === "ink-virtual-text") {
    markNodeAsDirty(node);
  }
}

export function cleanupYogaNode(node: YogaNode | undefined): void {
  node?.unsetMeasureFunc();
  node?.freeRecursive();
}
