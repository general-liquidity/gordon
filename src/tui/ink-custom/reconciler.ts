// reconciler — React reconciler host config targeting ink-custom/dom.
//
// Status: Phase 1+ (behind GORDON_CUSTOM_RENDER flag). Ported from Ink's
// `reconciler.js` verbatim where possible; changes are limited to swapping
// imports to our `domRuntime.ts` / `applyYogaStyles.ts`.
//
// Not exported from `index.ts` — only `render.ts` imports this module, and
// only when GORDON_CUSTOM_RENDER=1.

import process from "node:process";
// @ts-expect-error — react-reconciler ships no declarations; interop handled at runtime.
import createReconcilerImport from "react-reconciler";
// @ts-expect-error — react-reconciler/constants ships no declarations.
import { DefaultEventPriority, NoEventPriority } from "react-reconciler/constants.js";
import Yoga from "yoga-layout";
import { createContext } from "react";
import type { DOMElement, DOMNodeAttribute, TextNode } from "./dom.ts";
import {
  appendChildNode,
  cleanupYogaNode,
  createNode,
  createTextNode,
  insertBeforeNode,
  removeChildNode,
  setAttribute,
  setStyle,
  setTextNodeValue,
} from "./domRuntime.ts";
import applyYogaStyles from "./applyYogaStyles.ts";

type HostContext = { isInsideText: boolean };

// react-reconciler is a CJS module — resolve default via interop.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createReconciler = (createReconcilerImport as any).default ?? createReconcilerImport;

function diff(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (before === after) return undefined;
  if (!before) return after;
  const changed: Record<string, unknown> = {};
  let isChanged = false;
  for (const key of Object.keys(before)) {
    const isDeleted = after ? !Object.hasOwn(after, key) : true;
    if (isDeleted) {
      changed[key] = undefined;
      isChanged = true;
    }
  }
  if (after) {
    for (const key of Object.keys(after)) {
      if (after[key] !== before[key]) {
        changed[key] = after[key];
        isChanged = true;
      }
    }
  }
  return isChanged ? changed : undefined;
}

let currentUpdatePriority = NoEventPriority;
let currentRootNode: DOMElement | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reconciler: any = createReconciler({
  getRootHostContext: (): HostContext => ({ isInsideText: false }),
  prepareForCommit: () => null,
  preparePortalMount: () => null,
  clearContainer: () => false,
  resetAfterCommit(rootNode: DOMElement): void {
    if (typeof rootNode.onComputeLayout === "function") {
      rootNode.onComputeLayout();
    }
    if (rootNode.isStaticDirty) {
      rootNode.isStaticDirty = false;
      if (typeof rootNode.onImmediateRender === "function") {
        rootNode.onImmediateRender();
      }
      return;
    }
    if (typeof rootNode.onRender === "function") {
      rootNode.onRender();
    }
  },
  getChildHostContext(parentHostContext: HostContext, type: string): HostContext {
    const previousIsInsideText = parentHostContext.isInsideText;
    const isInsideText = type === "ink-text" || type === "ink-virtual-text";
    if (previousIsInsideText === isInsideText) return parentHostContext;
    return { isInsideText };
  },
  shouldSetTextContent: () => false,
  createInstance(
    originalType: string,
    newProps: Record<string, unknown>,
    rootNode: DOMElement,
    hostContext: HostContext,
  ): DOMElement {
    if (hostContext.isInsideText && originalType === "ink-box") {
      throw new Error("<Box> can’t be nested inside <Text> component");
    }
    const type =
      originalType === "ink-text" && hostContext.isInsideText
        ? "ink-virtual-text"
        : (originalType as DOMElement["nodeName"]);
    const node = createNode(type);
    for (const [key, value] of Object.entries(newProps)) {
      if (key === "children") continue;
      if (key === "style") {
        setStyle(node, value as DOMElement["style"]);
        if (node.yogaNode) applyYogaStyles(node.yogaNode, value as never);
        continue;
      }
      if (key === "internal_transform") {
        node.internal_transform = value as DOMElement["internal_transform"];
        continue;
      }
      if (key === "internal_static") {
        currentRootNode = rootNode;
        node.internal_static = true;
        rootNode.isStaticDirty = true;
        rootNode.staticNode = node;
        continue;
      }
      setAttribute(node, key, value as DOMNodeAttribute);
    }
    return node;
  },
  createTextInstance(text: string, _root: DOMElement, hostContext: HostContext): TextNode {
    if (!hostContext.isInsideText) {
      throw new Error(`Text string "${text}" must be rendered inside <Text> component`);
    }
    return createTextNode(text);
  },
  resetTextContent(): void {},
  hideTextInstance(node: TextNode): void {
    setTextNodeValue(node, "");
  },
  unhideTextInstance(node: TextNode, text: string): void {
    setTextNodeValue(node, text);
  },
  getPublicInstance: (instance: unknown) => instance,
  hideInstance(node: DOMElement): void {
    node.yogaNode?.setDisplay(Yoga.DISPLAY_NONE);
  },
  unhideInstance(node: DOMElement): void {
    node.yogaNode?.setDisplay(Yoga.DISPLAY_FLEX);
  },
  appendInitialChild: appendChildNode,
  appendChild: appendChildNode,
  insertBefore: insertBeforeNode,
  finalizeInitialChildren: () => false,
  isPrimaryRenderer: true,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  detachDeletedInstance() {},
  getInstanceFromNode: () => null,
  prepareScopeUpdate() {},
  getInstanceFromScope: () => null,
  appendChildToContainer: appendChildNode,
  insertInContainerBefore: insertBeforeNode,
  removeChildFromContainer(node: DOMElement, removeNode: DOMElement | TextNode): void {
    removeChildNode(node, removeNode);
    cleanupYogaNode((removeNode as DOMElement).yogaNode);
  },
  commitUpdate(
    node: DOMElement,
    _type: string,
    oldProps: Record<string, unknown>,
    newProps: Record<string, unknown>,
  ): void {
    if (currentRootNode && node.internal_static) {
      currentRootNode.isStaticDirty = true;
    }
    const props = diff(oldProps, newProps);
    const style = diff(
      oldProps.style as Record<string, unknown> | undefined,
      newProps.style as Record<string, unknown> | undefined,
    );
    if (!props && !style) return;
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (key === "style") {
          setStyle(node, value as DOMElement["style"]);
          continue;
        }
        if (key === "internal_transform") {
          node.internal_transform = value as DOMElement["internal_transform"];
          continue;
        }
        if (key === "internal_static") {
          node.internal_static = true;
          continue;
        }
        setAttribute(node, key, value as DOMNodeAttribute);
      }
    }
    if (style && node.yogaNode) {
      applyYogaStyles(node.yogaNode, style as never);
    }
  },
  commitTextUpdate(node: TextNode, _oldText: string, newText: string): void {
    setTextNodeValue(node, newText);
  },
  removeChild(node: DOMElement, removeNode: DOMElement | TextNode): void {
    removeChildNode(node, removeNode);
    cleanupYogaNode((removeNode as DOMElement).yogaNode);
  },
  setCurrentUpdatePriority(newPriority: number): void {
    currentUpdatePriority = newPriority;
  },
  getCurrentUpdatePriority: () => currentUpdatePriority,
  resolveUpdatePriority(): number {
    if (currentUpdatePriority !== NoEventPriority) return currentUpdatePriority;
    return DefaultEventPriority;
  },
  maySuspendCommit: () => false,
  NotPendingTransition: undefined,
  HostTransitionContext: createContext(null),
  resetFormInstance() {},
  requestPostPaintCallback() {},
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent() {},
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  preloadInstance: () => true,
  startSuspendingCommit() {},
  suspendInstance() {},
  waitForCommitToBeReady: () => null,
});

// Dev-tools hook, same as Ink.
if (process.env.DEV === "true") {
  try {
    reconciler.injectIntoDevTools({
      bundleType: 0,
      version: "16.13.1",
      rendererPackageName: "ink-custom",
    });
  } catch {
    // ignore — devtools not installed
  }
}

export default reconciler;
