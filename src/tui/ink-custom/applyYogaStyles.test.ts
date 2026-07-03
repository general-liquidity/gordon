import { afterEach, describe, expect, test } from "bun:test";
import Yoga from "yoga-layout";
import type { Node as YogaNode } from "yoga-layout";

import { applyYogaStyles } from "./applyYogaStyles.ts";

const created: YogaNode[] = [];
function node(): YogaNode {
  const n = Yoga.Node.create();
  created.push(n);
  return n;
}

afterEach(() => {
  for (const n of created) n.free();
  created.length = 0;
});

describe("applyYogaStyles — maxWidth / maxHeight", () => {
  test("maxWidth clamps a larger width", () => {
    const n = node();
    applyYogaStyles(n, { width: 100, maxWidth: 40 });
    n.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
    expect(n.getComputedWidth()).toBe(40);
  });

  test("maxHeight clamps a larger height", () => {
    const n = node();
    applyYogaStyles(n, { height: 100, maxHeight: 12 });
    n.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
    expect(n.getComputedHeight()).toBe(12);
  });

  test("percentage maxWidth clamps against the parent", () => {
    const parent = node();
    applyYogaStyles(parent, { width: 100, height: 10 });
    const child = node();
    applyYogaStyles(child, { width: 100, maxWidth: "50%" });
    parent.insertChild(child, 0);
    parent.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
    expect(child.getComputedWidth()).toBe(50);
  });
});

describe("applyYogaStyles — absolute offsets", () => {
  test("top / left position an absolutely-placed child", () => {
    const parent = node();
    applyYogaStyles(parent, { width: 100, height: 100 });
    const child = node();
    applyYogaStyles(child, {
      position: "absolute",
      top: 5,
      left: 7,
      width: 10,
      height: 10,
    });
    parent.insertChild(child, 0);
    parent.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
    expect(child.getComputedTop()).toBe(5);
    expect(child.getComputedLeft()).toBe(7);
  });

  test("right / bottom anchor to the opposite edges", () => {
    const parent = node();
    applyYogaStyles(parent, { width: 100, height: 100 });
    const child = node();
    applyYogaStyles(child, {
      position: "absolute",
      right: 8,
      bottom: 4,
      width: 10,
      height: 10,
    });
    parent.insertChild(child, 0);
    parent.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
    // width 10, right 8 => left edge at 100 - 8 - 10 = 82
    expect(child.getComputedLeft()).toBe(82);
    // height 10, bottom 4 => top edge at 100 - 4 - 10 = 86
    expect(child.getComputedTop()).toBe(86);
  });

  test("percentage offset resolves against the parent", () => {
    const parent = node();
    applyYogaStyles(parent, { width: 200, height: 100 });
    const child = node();
    applyYogaStyles(child, {
      position: "absolute",
      left: "25%",
      top: 0,
      width: 10,
      height: 10,
    });
    parent.insertChild(child, 0);
    parent.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
    expect(child.getComputedLeft()).toBe(50);
  });
});

describe("applyYogaStyles — aspectRatio", () => {
  test("derives height from width", () => {
    const parent = node();
    applyYogaStyles(parent, { width: 100, height: 100, alignItems: "flex-start" });
    const child = node();
    applyYogaStyles(child, { width: 40, aspectRatio: 2 });
    parent.insertChild(child, 0);
    parent.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
    expect(child.getComputedWidth()).toBe(40);
    expect(child.getComputedHeight()).toBe(20);
  });
});
