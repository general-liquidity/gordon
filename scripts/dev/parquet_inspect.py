#!/usr/bin/env python3
"""
Inspect the Model to Market parquet dataset WITHOUT loading 20GB into RAM.
Reports the file layout, schema, row counts, and a few sample rows so we can
write the right resampler (tick → 15-min bars + L2 snapshots).

    python scripts/dev/parquet_inspect.py <path-to-parquet-file-or-dir>

Only reads the first file's schema + first row group — fast even on huge data.
"""

import os
import sys

import pyarrow.parquet as pq


def human(n):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}PB"


def list_parquet(path):
    if os.path.isfile(path):
        return [path]
    files = []
    for root, _, names in os.walk(path):
        for name in names:
            if name.endswith(".parquet"):
                files.append(os.path.join(root, name))
    return sorted(files)


def main():
    if len(sys.argv) < 2:
        print("usage: python scripts/dev/parquet_inspect.py <path>")
        sys.exit(1)
    path = sys.argv[1]
    files = list_parquet(path)
    if not files:
        print(f"no .parquet files under {path}")
        sys.exit(1)

    total = sum(os.path.getsize(f) for f in files)
    print(f"\n── parquet dataset: {len(files)} file(s), {human(total)} total ──\n")
    for f in files[:40]:
        print(f"  {human(os.path.getsize(f)):>9}  {os.path.relpath(f, path if os.path.isdir(path) else os.path.dirname(path))}")
    if len(files) > 40:
        print(f"  … and {len(files) - 40} more")

    first = files[0]
    pf = pq.ParquetFile(first)
    print(f"\n── schema of {os.path.basename(first)} ──")
    print(f"  rows: {pf.metadata.num_rows:,}   row-groups: {pf.num_row_groups}   columns: {pf.metadata.num_columns}")
    print()
    for field in pf.schema_arrow:
        print(f"  {field.name:<28} {field.type}")

    print("\n── first 5 rows ──")
    sample = pf.read_row_group(0).slice(0, 5).to_pylist()
    for row in sample:
        print(f"  {row}")
    print()


if __name__ == "__main__":
    main()
