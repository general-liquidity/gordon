// Tests for renderNodeToOutput — paints a DOM tree into an OutputTarget /
// CellBuffer and verifies the glyphs land where Yoga's layout expects.
//
// The tests build DOM trees via `domRuntime.createNode` + `appendChildNode`
// instead of React, so they don't require the reconciler wire-up to pass.

import { describe, expect, test } from "bun:test";
import Yoga from "yoga-layout";
import { createNode, appendChildNode, createTextNode } from "./domRuntime.ts";
import applyYogaStyles from "./applyYogaStyles.ts";
import { createOutputTarget } from "./outputTarget.ts";
import { renderNodeToOutput } from "./renderNodeToOutput.ts";
import { createCellBuffer } from "./cellBuffer.ts";
import { createCharPool } from "./charPool.ts";
import { createStylePool } from "./stylePool.ts";

function layoutRoot(root: ReturnType<typeof createNode>, width = 40, height = 10): void {
  root.yogaNode?.setWidth(width);
  root.yogaNode?.setHeight(height);
  root.yogaNode?.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
}

describe("renderNodeToOutput", () => {
  test("renders a simple Text node into an OutputTarget", () => {
    const root = createNode("ink-root");
    const text = createNode("ink-text");
    const leaf = createTextNode("hello");
    appendChildNode(text, leaf);
    appendChildNode(root, text);

    layoutRoot(root, 20, 5);
    const out = createOutputTarget(20, 5);
    renderNodeToOutput(root, out, { skipStaticElements: true });

    const ansi = out.toAnsiString();
    expect(ansi).toContain("hello");
  });

  test("renders Text inside a Box at (0,0)", () => {
    const root = createNode("ink-root");
    const box = createNode("ink-box");
    if (box.yogaNode) applyYogaStyles(box.yogaNode, { flexDirection: "column" });
    const text = createNode("ink-text");
    appendChildNode(text, createTextNode("world"));
    appendChildNode(box, text);
    appendChildNode(root, box);

    layoutRoot(root, 30, 5);

    const out = createOutputTarget(30, 5);
    renderNodeToOutput(root, out, { skipStaticElements: true });

    // Paint into cell buffer to confirm OutputTarget -> CellBuffer works.
    const buffer = createCellBuffer(30, 5);
    const charPool = createCharPool();
    const stylePool = createStylePool();
    out.paintInto(buffer, charPool, stylePool);

    const firstCell = buffer.get(0, 0);
    expect(charPool.get(firstCell.charIdx)).toBe("w");
    const secondCell = buffer.get(1, 0);
    expect(charPool.get(secondCell.charIdx)).toBe("o");
    const thirdCell = buffer.get(2, 0);
    expect(charPool.get(thirdCell.charIdx)).toBe("r");
    const fourthCell = buffer.get(3, 0);
    expect(charPool.get(fourthCell.charIdx)).toBe("l");
    const fifthCell = buffer.get(4, 0);
    expect(charPool.get(fifthCell.charIdx)).toBe("d");
  });

  test("respects padding — text at (2,1) when box has padding 1,2", () => {
    const root = createNode("ink-root");
    const box = createNode("ink-box");
    if (box.yogaNode) applyYogaStyles(box.yogaNode, { paddingTop: 1, paddingLeft: 2 });
    const text = createNode("ink-text");
    appendChildNode(text, createTextNode("pad"));
    appendChildNode(box, text);
    appendChildNode(root, box);

    layoutRoot(root, 20, 5);
    const out = createOutputTarget(20, 5);
    renderNodeToOutput(root, out, { skipStaticElements: true });

    const buffer = createCellBuffer(20, 5);
    const charPool = createCharPool();
    const stylePool = createStylePool();
    out.paintInto(buffer, charPool, stylePool);

    expect(charPool.get(buffer.get(2, 1).charIdx)).toBe("p");
    expect(charPool.get(buffer.get(3, 1).charIdx)).toBe("a");
    expect(charPool.get(buffer.get(4, 1).charIdx)).toBe("d");
    // Cells outside the text should be spaces.
    expect(charPool.get(buffer.get(0, 0).charIdx)).toBe(" ");
  });

  test("renders a border around a Box", () => {
    const root = createNode("ink-root");
    const box = createNode("ink-box");
    if (box.yogaNode) applyYogaStyles(box.yogaNode, { borderStyle: "single", width: 6, height: 3 });
    // Set borderStyle via the node.style field (render-border reads from there).
    box.style = { ...box.style, borderStyle: "single" };
    appendChildNode(root, box);

    layoutRoot(root, 20, 5);
    const out = createOutputTarget(20, 5);
    renderNodeToOutput(root, out, { skipStaticElements: true });

    const ansi = out.toAnsiString();
    // Top-left corner of "single" style
    expect(ansi).toContain("┌");
    expect(ansi).toContain("┐");
    expect(ansi).toContain("└");
    expect(ansi).toContain("┘");
  });

  test("text wraps at maxWidth", () => {
    const root = createNode("ink-root");
    const text = createNode("ink-text");
    appendChildNode(text, createTextNode("abcdefghij"));
    appendChildNode(root, text);
    if (root.yogaNode) applyYogaStyles(root.yogaNode, { width: 5, height: 3 });

    layoutRoot(root, 5, 3);

    const out = createOutputTarget(5, 3);
    renderNodeToOutput(root, out, { skipStaticElements: true });
    const ansi = out.toAnsiString();
    // After wrapping at width=5, we expect "abcde" on line 0, "fghij" on line 1.
    const lines = ansi.split("\n");
    expect(lines[0]).toContain("abcde");
    expect(lines[1]).toContain("fghij");
  });

  test("respects skipStaticElements", () => {
    const root = createNode("ink-root");
    const box = createNode("ink-box");
    box.internal_static = true;
    const text = createNode("ink-text");
    appendChildNode(text, createTextNode("static-only"));
    appendChildNode(box, text);
    appendChildNode(root, box);

    layoutRoot(root, 30, 3);

    const out = createOutputTarget(30, 3);
    renderNodeToOutput(root, out, { skipStaticElements: true });
    const ansi = out.toAnsiString();
    // skipStaticElements means the static box is not painted in the main pass.
    expect(ansi).not.toContain("static-only");
  });
});
