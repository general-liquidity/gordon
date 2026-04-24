// Tests for outputTarget — OSC 8 hyperlink threading through the paint
// pipeline. Two paths are exercised:
//
//   1. Legacy inline-passthrough: `toAnsiString()` with no HyperlinkPool.
//      @alcalzone/ansi-tokenize preserves OSC 8 codes in each char's styles[];
//      the serializer emits them per-cell. URLs survive, but emission is
//      verbose (one open+close wrapper per cell). Verified here so a future
//      optimization can't silently drop OSC 8 in this path.
//   2. Side-table: `paintInto(..., hyperlinkPool)` + `toAnsiString(pool)`.
//      URLs are interned into HyperlinkPool; the CellBuffer stores a styleId
//      whose string is link-free; a cell-level Map records hyperlink IDs;
//      `toAnsiString(pool)` wraps contiguous same-ID runs with a single open/
//      close pair. This is the correct emission shape and is a prerequisite
//      for the future incremental-patch transport.

import { describe, expect, test } from "bun:test";
import { createOutputTarget } from "./outputTarget.ts";
import { createCellBuffer } from "./cellBuffer.ts";
import { createCharPool } from "./charPool.ts";
import { createStylePool } from "./stylePool.ts";
import { createHyperlinkPool } from "./hyperlinkPool.ts";

const LINK_OPEN = (url: string): string => `\x1b]8;;${url}\x07`;
const LINK_CLOSE = "\x1b]8;;\x07";

describe("outputTarget OSC 8 hyperlinks", () => {
  test("legacy passthrough: toAnsiString() without pool preserves URL", () => {
    // Paint "pre LINK post" where LINK is an OSC 8 hyperlink.
    const out = createOutputTarget(20, 1);
    const url = "https://example.com";
    const text = `pre ${LINK_OPEN(url)}link${LINK_CLOSE} post`;
    out.write(0, 0, text, { transformers: [] });

    const ansi = out.toAnsiString();

    // URL must survive — either in an open code or as raw text. The
    // passthrough path emits OSC 8 per-cell so the URL appears verbatim.
    expect(ansi).toContain(url);
    expect(ansi).toContain(LINK_OPEN(url));
  });

  test("side-table: paintInto+toAnsiString(pool) interns URL and emits bounded run", () => {
    const out = createOutputTarget(20, 1);
    const pool = createHyperlinkPool();
    const url = "https://example.com";
    const text = `pre ${LINK_OPEN(url)}link${LINK_CLOSE} post`;
    out.write(0, 0, text, { transformers: [] });

    const buffer = createCellBuffer(20, 1);
    const charPool = createCharPool();
    const stylePool = createStylePool();
    out.paintInto(buffer, charPool, stylePool, pool);

    // URL was interned.
    expect(pool.size).toBe(1);

    const ansi = out.toAnsiString(pool);

    // One open, one close — not per-cell.
    const opens = ansi.split(LINK_OPEN(url)).length - 1;
    const closes = ansi.split(LINK_CLOSE).length - 1;
    expect(opens).toBe(1);
    // Closes fire at the transition out of the run AND end-of-row, so we
    // expect exactly one for a single run ending before the row's trailing
    // whitespace gets stripped.
    expect(closes).toBe(1);
    // URL visible exactly once (inside the open sequence).
    expect(ansi).toContain(url);
    expect(ansi.split(url).length - 1).toBe(1);
  });

  test("side-table: getHyperlinkAt reports IDs for hyperlink cells, null elsewhere", () => {
    const out = createOutputTarget(20, 1);
    const pool = createHyperlinkPool();
    const url = "https://x.test";
    // "AB" (no link), then "CD" (linked), then "EF" (no link).
    const text = `AB${LINK_OPEN(url)}CD${LINK_CLOSE}EF`;
    out.write(0, 0, text, { transformers: [] });

    const buffer = createCellBuffer(20, 1);
    const charPool = createCharPool();
    const stylePool = createStylePool();
    out.paintInto(buffer, charPool, stylePool, pool);

    // "AB" — no hyperlink.
    expect(out.getHyperlinkAt(0, 0)).toBeNull();
    expect(out.getHyperlinkAt(1, 0)).toBeNull();
    // "CD" — hyperlink, same ID on both cells.
    const idC = out.getHyperlinkAt(2, 0);
    const idD = out.getHyperlinkAt(3, 0);
    expect(idC).not.toBeNull();
    expect(idD).toBe(idC);
    expect(pool.get(idC!)).toBe(url);
    // "EF" — no hyperlink again.
    expect(out.getHyperlinkAt(4, 0)).toBeNull();
    expect(out.getHyperlinkAt(5, 0)).toBeNull();
    // Out-of-bounds or blank cells stay null.
    expect(out.getHyperlinkAt(19, 0)).toBeNull();
  });

  test("side-table: same URL twice reuses one pool entry (interning is stable)", () => {
    const out = createOutputTarget(40, 1);
    const pool = createHyperlinkPool();
    const url = "https://repeat.test";
    // Two distinct link runs on the same URL.
    const text = `${LINK_OPEN(url)}A${LINK_CLOSE} mid ${LINK_OPEN(url)}B${LINK_CLOSE}`;
    out.write(0, 0, text, { transformers: [] });

    const buffer = createCellBuffer(40, 1);
    const charPool = createCharPool();
    const stylePool = createStylePool();
    out.paintInto(buffer, charPool, stylePool, pool);

    // Pool must carry a single entry — `intern(sameUrl)` returns the same ID.
    expect(pool.size).toBe(1);
    expect(pool.stats().size).toBe(1);
    const idA = out.getHyperlinkAt(0, 0);
    const idB = out.getHyperlinkAt(6, 0); // After "A mid " (6 chars) — "B".
    expect(idA).toBe(idB);
  });

  test("side-table: different URLs produce distinct pool IDs", () => {
    const out = createOutputTarget(40, 1);
    const pool = createHyperlinkPool();
    const urlA = "https://a.test";
    const urlB = "https://b.test";
    const text = `${LINK_OPEN(urlA)}A${LINK_CLOSE} ${LINK_OPEN(urlB)}B${LINK_CLOSE}`;
    out.write(0, 0, text, { transformers: [] });

    const buffer = createCellBuffer(40, 1);
    const charPool = createCharPool();
    const stylePool = createStylePool();
    out.paintInto(buffer, charPool, stylePool, pool);

    expect(pool.size).toBe(2);
    const idA = out.getHyperlinkAt(0, 0);
    const idB = out.getHyperlinkAt(2, 0);
    expect(idA).not.toBeNull();
    expect(idB).not.toBeNull();
    expect(idA).not.toBe(idB);
    expect(pool.get(idA!)).toBe(urlA);
    expect(pool.get(idB!)).toBe(urlB);
  });

  test("side-table: non-link text leaves pool empty and side-table clear", () => {
    const out = createOutputTarget(20, 1);
    const pool = createHyperlinkPool();
    out.write(0, 0, "plain text no link", { transformers: [] });

    const buffer = createCellBuffer(20, 1);
    const charPool = createCharPool();
    const stylePool = createStylePool();
    out.paintInto(buffer, charPool, stylePool, pool);

    expect(pool.size).toBe(0);
    expect(out.getHyperlinkAt(0, 0)).toBeNull();
    expect(out.getHyperlinkAt(5, 0)).toBeNull();

    const ansi = out.toAnsiString(pool);
    expect(ansi).not.toContain("\x1b]8");
  });

  test("side-table: stylePool stays URL-free when HyperlinkPool is threaded", () => {
    // With the pool threaded, link codes must be stripped from the style
    // string that feeds StylePool — otherwise StylePool saturates with URL
    // variants and loses its compactness benefit.
    const out = createOutputTarget(20, 1);
    const pool = createHyperlinkPool();
    const url = "https://example.com/very/long/url/path";
    const text = `${LINK_OPEN(url)}hello${LINK_CLOSE}`;
    out.write(0, 0, text, { transformers: [] });

    const buffer = createCellBuffer(20, 1);
    const charPool = createCharPool();
    const stylePool = createStylePool();
    out.paintInto(buffer, charPool, stylePool, pool);

    // Every style string currently in the pool must be URL-free.
    for (let id = 0; id < stylePool.size; id++) {
      const s = stylePool.get(id);
      if (s === undefined) continue;
      expect(s.includes("\x1b]8;;")).toBe(false);
    }
  });

  test("side-table: paint clears the hyperlink side-table between passes", () => {
    // A fresh paintInto() on the same OutputTarget (via re-queueing writes)
    // should not carry hyperlink ghosts from the previous pass.
    const out = createOutputTarget(20, 1);
    const pool = createHyperlinkPool();
    const url = "https://ghost.test";
    out.write(0, 0, `${LINK_OPEN(url)}linked${LINK_CLOSE}`, { transformers: [] });

    const buffer = createCellBuffer(20, 1);
    const charPool = createCharPool();
    const stylePool = createStylePool();
    out.paintInto(buffer, charPool, stylePool, pool);
    expect(out.getHyperlinkAt(0, 0)).not.toBeNull();

    // Second paintInto() on the SAME OutputTarget (operations queue replayed).
    // The side table must be rebuilt, not appended.
    out.paintInto(buffer, charPool, stylePool, pool);
    // After re-paint, the cell is still linked (same ops) — but this verifies
    // the clear-then-rebuild path runs (no double-counted IDs in pool).
    expect(pool.size).toBe(1);
    expect(out.getHyperlinkAt(0, 0)).not.toBeNull();
  });
});
