#!/usr/bin/env python3
"""
Extract L2 order-book microstructure features from the Model to Market tick
parquet → M15 buckets the TS pipeline can read (data/momq/l2/<SYM>_M15.json:
list of {time epoch-sec, imbalance, micropriceVsMid, spread, ticks}).

Per tick it reads the 5-level ladder columns (bidprices/bidsizes/askprices/
asksizes) plus top-of-book bid/ask, and computes:
  - order-book imbalance  (Σbid − Σask)/(Σbid + Σask)  ∈ [-1, +1]
  - microprice            (bestBid·askSz + bestAsk·bidSz)/(bidSz + askSz)
  - spread                ask − bid
then aggregates to 15-min buckets: mean imbalance, mean (microprice − mid),
mean spread, tick count. Mirrors the core primitive in
src/core/microstructure/book-imbalance.ts.

Memory-safe: processes ONE daily file at a time, projecting only the columns it
needs via pyarrow, so the dataset streams through without loading it all.

HEAVY ONE-TIME JOB — the full dataset is ~21GB. DO NOT run this over the whole
directory casually. To sanity-check, point it at a single small day, e.g.:

    PYTHONIOENCODING=utf-8 python scripts/dev/data/parquet_l2_features.py \
        data/pricer-output-2026-05-11_2026-06-10/AUDJPY_2026_05_17.parquet

    python scripts/dev/data/parquet_l2_features.py [input_dir_or_file] [timeframe=15min] [tag=M15]
"""

import glob
import json
import os
import sys
from collections import defaultdict

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

IN = sys.argv[1] if len(sys.argv) > 1 else "data/pricer-output-2026-05-11_2026-06-10"
TF = sys.argv[2] if len(sys.argv) > 2 else "15min"
TAG = sys.argv[3] if len(sys.argv) > 3 else "M15"
OUT = "data/momq/l2"
# Optional comma-separated symbol filter (e.g. L2_SYMBOLS=EURUSD,XAUUSD) — skips
# everything else. Useful to extract only the tradeable instruments and avoid the
# heavy non-tradeable gold variants / oil.
WANTED = {s.strip() for s in os.environ.get("L2_SYMBOLS", "").split(",") if s.strip()}

LADDER_COLS = ["time", "bid", "ask", "bidprices", "bidsizes", "askprices", "asksizes"]


def symbol_of(path: str) -> str:
    # "<SYM>_YYYY_MM_DD.parquet" → "<SYM>"
    return os.path.basename(path).rsplit("_", 3)[0]


def _sum_sizes(col: pd.Series) -> np.ndarray:
    # Each cell is a list<int64> (up to 5 levels); negatives/NaN clamped to 0.
    out = np.zeros(len(col), dtype=np.float64)
    for i, lst in enumerate(col.to_numpy()):
        if lst is None:
            continue
        for s in lst:
            if s is not None and s > 0:
                out[i] += s
    return out


def _top(col: pd.Series, default=np.nan) -> np.ndarray:
    out = np.full(len(col), default, dtype=np.float64)
    for i, lst in enumerate(col.to_numpy()):
        if lst is not None and len(lst) > 0 and lst[0] is not None:
            out[i] = lst[0]
    return out


def features_of(tbl: pd.DataFrame) -> pd.DataFrame:
    # Sum of ladder sizes per side.
    bid_sz = _sum_sizes(tbl["bidsizes"])
    ask_sz = _sum_sizes(tbl["asksizes"])

    denom = bid_sz + ask_sz
    imbalance = np.where(denom == 0, 0.0, (bid_sz - ask_sz) / denom)

    # Top-of-book for microprice / spread / mid. Prefer ladder L1, fall back to
    # the scalar bid/ask columns.
    best_bid = _top(tbl["bidprices"])
    best_ask = _top(tbl["askprices"])
    best_bid = np.where(np.isnan(best_bid), tbl["bid"].to_numpy(dtype=np.float64), best_bid)
    best_ask = np.where(np.isnan(best_ask), tbl["ask"].to_numpy(dtype=np.float64), best_ask)

    top_bid_sz = _top(tbl["bidsizes"], default=0.0)
    top_ask_sz = _top(tbl["asksizes"], default=0.0)
    top_bid_sz = np.clip(top_bid_sz, 0, None)
    top_ask_sz = np.clip(top_ask_sz, 0, None)

    mid = (best_bid + best_ask) / 2.0
    size_tot = top_bid_sz + top_ask_sz
    # Size-weighted microprice; zero total size → plain mid.
    micro = np.where(
        size_tot == 0,
        mid,
        (best_bid * top_ask_sz + best_ask * top_bid_sz) / np.where(size_tot == 0, 1.0, size_tot),
    )

    spread = best_ask - best_bid

    return pd.DataFrame(
        {
            "imbalance": imbalance,
            "micropriceVsMid": micro - mid,
            "spread": spread,
        },
        index=tbl.index,
    )


def main():
    os.makedirs(OUT, exist_ok=True)
    if os.path.isdir(IN):
        files = glob.glob(os.path.join(IN, "*.parquet"))
    else:
        files = [IN]
    by_sym = defaultdict(list)
    for f in files:
        sym = symbol_of(f)
        if WANTED and sym not in WANTED:
            continue
        by_sym[sym].append(f)

    print(f"L2 features: {len(by_sym)} symbols{' (filtered)' if WANTED else ''} → {OUT} ({TAG})", flush=True)
    for sym, fs in sorted(by_sym.items()):
        rows = []
        for f in sorted(fs):
            tbl = pq.read_table(f, columns=LADDER_COLS).to_pandas()
            if tbl.empty:
                continue
            tbl["ts"] = pd.to_datetime(tbl["time"])
            tbl = tbl.set_index("ts").sort_index()
            feats = features_of(tbl)
            agg = feats.resample(TF).agg(
                imbalance=("imbalance", "mean"),
                micropriceVsMid=("micropriceVsMid", "mean"),
                spread=("spread", "mean"),
                ticks=("imbalance", "count"),
            )
            for ts, row in agg.iterrows():
                if row["ticks"] == 0:
                    continue
                rows.append({
                    "time": int(ts.timestamp()),
                    "imbalance": float(row["imbalance"]) if not pd.isna(row["imbalance"]) else 0.0,
                    "micropriceVsMid": float(row["micropriceVsMid"]) if not pd.isna(row["micropriceVsMid"]) else 0.0,
                    "spread": float(row["spread"]) if not pd.isna(row["spread"]) else 0.0,
                    "ticks": int(row["ticks"]),
                })
        rows.sort(key=lambda b: b["time"])
        with open(os.path.join(OUT, f"{sym}_{TAG}.json"), "w") as fh:
            json.dump(rows, fh)
        print(f"  {sym:12} {len(rows):6} buckets", flush=True)
    print("done", flush=True)


if __name__ == "__main__":
    main()
