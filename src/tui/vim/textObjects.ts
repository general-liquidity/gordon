// ============================================================================
// Vim Text Objects — Inner/around selections (iw, aw, i", a", i(, etc.)
// ============================================================================

const WORD_CHAR = /[a-zA-Z0-9_]/;
const PAIRS: Record<string, [string, string]> = {
  "(": ["(", ")"], ")": ["(", ")"],
  "[": ["[", "]"], "]": ["[", "]"],
  "{": ["{", "}"], "}": ["{", "}"],
  "<": ["<", ">"], ">": ["<", ">"],
  '"': ['"', '"'],
  "'": ["'", "'"],
  "`": ["`", "`"],
};

export function selectTextObject(
  text: string,
  cursor: number,
  object: string,
): { start: number; end: number } | null {
  const inner = object.startsWith("i");
  const char = object.slice(1);

  if (char === "w") {
    return selectWord(text, cursor, inner);
  }

  const pair = PAIRS[char];
  if (pair) {
    return selectPair(text, cursor, pair[0], pair[1], inner);
  }

  return null;
}

function selectWord(text: string, cursor: number, inner: boolean): { start: number; end: number } | null {
  if (cursor >= text.length) return null;

  let start = cursor;
  let end = cursor;

  const isWord = WORD_CHAR.test(text[cursor]!);

  // Expand to word boundaries
  while (start > 0 && WORD_CHAR.test(text[start - 1]!) === isWord) start--;
  while (end < text.length - 1 && WORD_CHAR.test(text[end + 1]!) === isWord) end++;

  if (!inner) {
    // "a word" includes trailing whitespace
    while (end < text.length - 1 && text[end + 1] === " ") end++;
  }

  return { start, end: end + 1 };
}

function selectPair(
  text: string,
  cursor: number,
  open: string,
  close: string,
  inner: boolean,
): { start: number; end: number } | null {
  // Find the opening delimiter
  let start = cursor;
  let depth = 0;

  if (open === close) {
    // For matching delimiters (quotes), find the surrounding pair
    let openPos = -1;
    let closePos = -1;
    for (let i = cursor; i >= 0; i--) {
      if (text[i] === open) { openPos = i; break; }
    }
    for (let i = cursor + 1; i < text.length; i++) {
      if (text[i] === close) { closePos = i; break; }
    }
    if (openPos === -1 || closePos === -1) return null;
    return inner
      ? { start: openPos + 1, end: closePos }
      : { start: openPos, end: closePos + 1 };
  }

  // For different open/close, use depth counting
  for (let i = cursor; i >= 0; i--) {
    if (text[i] === close) depth++;
    if (text[i] === open) {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }

  depth = 0;
  let end = cursor;
  for (let i = cursor; i < text.length; i++) {
    if (text[i] === open && i !== start) depth++;
    if (text[i] === close) {
      if (depth === 0) { end = i; break; }
      depth--;
    }
  }

  if (text[start] !== open || text[end] !== close) return null;

  return inner
    ? { start: start + 1, end }
    : { start, end: end + 1 };
}
