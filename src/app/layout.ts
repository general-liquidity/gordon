import { measureElement, type DOMElement } from "ink";
import { type Dispatch, type SetStateAction, useState } from "react";

export function useMeasuredWidth(fallback: number = 80): {
  ref: Dispatch<SetStateAction<DOMElement | null>>;
  width: number;
} {
  const [width, setWidth] = useState(fallback);
  const [ref, setRef] = useState<DOMElement | null>(null);

  if (ref) {
    const dimensions = measureElement(ref);
    if (dimensions.width > 0 && dimensions.width !== width) {
      setWidth(dimensions.width);
    }
  }

  return {
    ref: setRef,
    width,
  };
}

export function truncateWithEllipsis(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

export function clampWidth(width: number, minWidth: number, maxWidth: number): number {
  return Math.max(minWidth, Math.min(maxWidth, width));
}

export function fitColumnWidths(options: {
  widths: number[];
  maxTotalWidth: number;
  minWidth?: number;
}): number[] {
  const { widths, maxTotalWidth, minWidth = 6 } = options;
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= maxTotalWidth) {
    return widths;
  }

  const next = [...widths];
  let overflow = total - maxTotalWidth;

  while (overflow > 0) {
    const shrinkableIndex = next.findIndex((width) => width > minWidth);
    if (shrinkableIndex === -1) {
      break;
    }

    const currentWidth = next[shrinkableIndex];
    if (currentWidth === undefined) {
      break;
    }

    next[shrinkableIndex] = currentWidth - 1;
    overflow -= 1;
  }

  return next;
}
