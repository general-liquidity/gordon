#!/usr/bin/env python3
"""
Resample the Model to Market tick parquet (top-of-book bid/ask) → OHLC bars that
the TS pipeline already reads (data/momq/bars/<SYM>_<TF>.json, same shape as the
bridge pull: time epoch-sec, open/high/low/close, tickVolume, spread, realVolume).

Memory-safe: processes ONE daily file at a time, projecting only time/bid/ask
(skips the heavy L2 ladder columns), so 21GB streams through fine.

    python scripts/dev/data/parquet_resample.py [input_dir] [timeframe=15min] [tag=M15]
"""

import glob
import json
import os
import sys
from collections import defaultdict

import pandas as pd
import pyarrow.parquet as pq

IN = sys.argv[1] if len(sys.argv) > 1 else "data/pricer-output-2026-05-11_2026-06-10"
TF = sys.argv[2] if len(sys.argv) > 2 else "15min"
TAG = sys.argv[3] if len(sys.argv) > 3 else "M15"
OUT = "data/momq/bars"


def symbol_of(path: str) -> str:
    # "<SYM>_YYYY_MM_DD.parquet" → "<SYM>"
    return os.path.basename(path).rsplit("_", 3)[0]


def main():
    os.makedirs(OUT, exist_ok=True)
    files = [f for f in glob.glob(os.path.join(IN, "*.parquet"))]
    by_sym = defaultdict(list)
    for f in files:
        by_sym[symbol_of(f)].append(f)

    print(f"resampling {len(files)} files / {len(by_sym)} symbols → {OUT} ({TAG})", flush=True)
    for sym, fs in sorted(by_sym.items()):
        bars = []
        for f in sorted(fs):
            tbl = pq.read_table(f, columns=["time", "bid", "ask"]).to_pandas()
            if tbl.empty:
                continue
            tbl["ts"] = pd.to_datetime(tbl["time"])
            tbl = tbl.set_index("ts").sort_index()
            mid = (tbl["bid"] + tbl["ask"]) / 2.0   # inherits the DatetimeIndex
            spread = tbl["ask"] - tbl["bid"]
            ohlc = mid.resample(TF).agg(["first", "max", "min", "last", "count"])
            sp = spread.resample(TF).mean()
            for ts, row in ohlc.iterrows():
                if pd.isna(row["first"]):
                    continue
                s = sp.loc[ts]
                bars.append({
                    "time": int(ts.timestamp()),
                    "open": float(row["first"]), "high": float(row["max"]),
                    "low": float(row["min"]), "close": float(row["last"]),
                    "tickVolume": int(row["count"]),
                    "spread": float(s) if not pd.isna(s) else 0.0,
                    "realVolume": 0,
                })
        bars.sort(key=lambda b: b["time"])
        with open(os.path.join(OUT, f"{sym}_{TAG}.json"), "w") as fh:
            json.dump(bars, fh)
        print(f"  {sym:12} {len(bars):6} bars", flush=True)
    print("done", flush=True)


if __name__ == "__main__":
    main()
