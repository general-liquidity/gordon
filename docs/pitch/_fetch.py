#!/usr/bin/env python3
"""Minimal article extractor. Fetches with a browser UA, strips script/style,
collapses tags to text, decodes entities, and prints the body."""
import sys
import re
import html
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
    enc = resp.headers.get_content_charset() or "utf-8"
    return raw.decode(enc, errors="replace")

def extract(doc: str) -> str:
    doc = re.sub(r"<script[\s\S]*?</script>", " ", doc, flags=re.I)
    doc = re.sub(r"<style[\s\S]*?</style>", " ", doc, flags=re.I)
    doc = re.sub(r"<noscript[\s\S]*?</noscript>", " ", doc, flags=re.I)
    doc = re.sub(r"<nav[\s\S]*?</nav>", " ", doc, flags=re.I)
    doc = re.sub(r"<header[\s\S]*?</header>", " ", doc, flags=re.I)
    doc = re.sub(r"<footer[\s\S]*?</footer>", " ", doc, flags=re.I)
    doc = re.sub(r"<aside[\s\S]*?</aside>", " ", doc, flags=re.I)
    doc = re.sub(r"<!--[\s\S]*?-->", " ", doc)

    doc = re.sub(r"</(p|div|section|article|h[1-6]|li|ul|ol|br|tr|td)>",
                 "\n\n", doc, flags=re.I)
    doc = re.sub(r"<br\s*/?>", "\n", doc, flags=re.I)
    doc = re.sub(r"<[^>]+>", " ", doc)
    doc = html.unescape(doc)
    doc = re.sub(r"[ \t]+", " ", doc)
    doc = re.sub(r"\n\s*\n\s*\n+", "\n\n", doc)
    return doc.strip()

if __name__ == "__main__":
    url = sys.argv[1]
    try:
        print(extract(fetch(url)))
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
