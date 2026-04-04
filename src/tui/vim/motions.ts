// ============================================================================
// Vim Motions — Cursor movement commands (h, l, w, b, e, 0, $, ^)
// ============================================================================

const WORD_CHAR = /[a-zA-Z0-9_]/;

export function applyMotion(text: string, cursor: number, motion: string, count = 1): number {
  let pos = cursor;

  for (let i = 0; i < count; i++) {
    switch (motion) {
      case "h": pos = Math.max(0, pos - 1); break;
      case "l": pos = Math.min(text.length - 1, pos + 1); break;
      case "w": pos = nextWordStart(text, pos); break;
      case "b": pos = prevWordStart(text, pos); break;
      case "e": pos = wordEnd(text, pos); break;
      case "W": pos = nextWORDStart(text, pos); break;
      case "B": pos = prevWORDStart(text, pos); break;
      case "E": pos = WORDEnd(text, pos); break;
      case "0": pos = 0; break;
      case "$": pos = text.length > 0 ? text.length - 1 : 0; break;
      case "^": pos = firstNonSpace(text); break;
    }
  }

  return Math.max(0, Math.min(pos, Math.max(0, text.length - 1)));
}

function nextWordStart(text: string, pos: number): number {
  let i = pos;
  if (i >= text.length) return i;
  const startIsWord = WORD_CHAR.test(text[i]!);
  // Skip current word/non-word sequence
  while (i < text.length && WORD_CHAR.test(text[i]!) === startIsWord && text[i] !== " ") i++;
  // Skip spaces
  while (i < text.length && text[i] === " ") i++;
  return i;
}

function prevWordStart(text: string, pos: number): number {
  let i = pos - 1;
  if (i < 0) return 0;
  // Skip spaces
  while (i > 0 && text[i] === " ") i--;
  // Skip current word
  const isWord = WORD_CHAR.test(text[i]!);
  while (i > 0 && WORD_CHAR.test(text[i - 1]!) === isWord && text[i - 1] !== " ") i--;
  return i;
}

function wordEnd(text: string, pos: number): number {
  let i = pos + 1;
  if (i >= text.length) return Math.max(0, text.length - 1);
  // Skip spaces
  while (i < text.length && text[i] === " ") i++;
  // Move to end of word
  const isWord = WORD_CHAR.test(text[i]!);
  while (i < text.length - 1 && WORD_CHAR.test(text[i + 1]!) === isWord && text[i + 1] !== " ") i++;
  return i;
}

function nextWORDStart(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && text[i] !== " ") i++;
  while (i < text.length && text[i] === " ") i++;
  return i;
}

function prevWORDStart(text: string, pos: number): number {
  let i = pos - 1;
  while (i > 0 && text[i] === " ") i--;
  while (i > 0 && text[i - 1] !== " ") i--;
  return i;
}

function WORDEnd(text: string, pos: number): number {
  let i = pos + 1;
  while (i < text.length && text[i] === " ") i++;
  while (i < text.length - 1 && text[i + 1] !== " ") i++;
  return i;
}

function firstNonSpace(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== " ") return i;
  }
  return 0;
}
