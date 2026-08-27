export interface TripleBarrierLabel {
  entryIndex: number;
  label: -1 | 0 | 1;
  touchIndex: number;
  touchReason: "pt" | "sl" | "vertical";
  returnAtTouch: number;
}

export interface TripleBarrierResult {
  labels: Array<TripleBarrierLabel>;
  ptCount: number;
  slCount: number;
  verticalCount: number;
  sampleSize: number;
  interpretation: string;
}

function neutral(reason: string): TripleBarrierResult {
  return {
    labels: [],
    ptCount: 0,
    slCount: 0,
    verticalCount: 0,
    sampleSize: 0,
    interpretation: reason,
  };
}

// López de Prado triple-barrier OUTCOME labeler (pure labeler — no meta-labeling,
// no ML sample weights). For each entry, which barrier (profit-take / stop-loss /
// vertical-time) is touched FIRST decides the label.
export function computeTripleBarrier(input: {
  prices: ReadonlyArray<number>;
  entries: ReadonlyArray<number>;
  ptPct: number;
  slPct: number;
  verticalBars: number;
  side?: "long" | "short";
}): TripleBarrierResult {
  const { prices, entries, ptPct, slPct, verticalBars } = input;
  const side = input.side ?? "long";

  if (prices == null || prices.length < 2) {
    return neutral("Insufficient price data (need >= 2 bars).");
  }
  if (entries == null || entries.length === 0) {
    return neutral("No entries supplied.");
  }
  if (!(verticalBars >= 1)) {
    return neutral("verticalBars must be >= 1.");
  }

  const end = prices.length - 1;
  const labels: Array<TripleBarrierLabel> = [];
  let ptCount = 0;
  let slCount = 0;
  let verticalCount = 0;

  for (const entryIndex of entries) {
    if (entryIndex == null || entryIndex < 0 || entryIndex >= end) {
      continue;
    }
    const entryPrice = prices[entryIndex]!;
    if (!(entryPrice > 0)) {
      continue;
    }

    const ptLevel = side === "long" ? entryPrice * (1 + ptPct) : entryPrice * (1 - ptPct);
    const slLevel = side === "long" ? entryPrice * (1 - slPct) : entryPrice * (1 + slPct);

    const verticalIndex = Math.min(entryIndex + verticalBars, end);

    let touchIndex = verticalIndex;
    let touchReason: "pt" | "sl" | "vertical" = "vertical";
    let label: -1 | 0 | 1 = 0;

    for (let i = entryIndex + 1; i <= verticalIndex; i++) {
      const price = prices[i]!;
      const hitPt = side === "long" ? price >= ptLevel : price <= ptLevel;
      const hitSl = side === "long" ? price <= slLevel : price >= slLevel;
      if (hitPt) {
        touchIndex = i;
        touchReason = "pt";
        label = 1;
        break;
      }
      if (hitSl) {
        touchIndex = i;
        touchReason = "sl";
        label = -1;
        break;
      }
    }

    if (touchReason === "pt") ptCount++;
    else if (touchReason === "sl") slCount++;
    else verticalCount++;

    const touchPrice = prices[touchIndex]!;
    const rawReturn =
      side === "long" ? touchPrice / entryPrice - 1 : -(touchPrice / entryPrice - 1);
    const returnAtTouch = Number(rawReturn.toFixed(6));

    labels.push({ entryIndex, label, touchIndex, touchReason, returnAtTouch });
  }

  const sampleSize = labels.length;
  if (sampleSize === 0) {
    return neutral("No valid entries within price series bounds.");
  }

  const interpretation =
    `Triple-barrier (${side}, pt=${(ptPct * 100).toFixed(2)}%, ` +
    `sl=${(slPct * 100).toFixed(2)}%, vertical=${verticalBars} bars): ` +
    `${ptCount} PT / ${slCount} SL / ${verticalCount} vertical over ${sampleSize} entries.`;

  return { labels, ptCount, slCount, verticalCount, sampleSize, interpretation };
}
