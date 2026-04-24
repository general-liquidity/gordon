#!/usr/bin/env python3
"""
Build PDFs for the company briefs.

Uses markdown-pdf (PyMuPDF-based). Handles:
  - GFM-style tables
  - Blockquotes
  - Inline images (base64-embedded so path resolution can't fail)
  - Per-section pagination (new page per H2)
"""
import os
import sys
import re
import base64
import mimetypes
from pathlib import Path

import fitz  # PyMuPDF — already a transitive dep of markdown-pdf
from markdown_pdf import MarkdownPdf, Section

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent  # project root (docs/pitch/.. = docs, /.. = repo root)
ASSETS = ROOT / "assets"

# Lightweight CSS for readable print. Serif body, table borders, page-break
# rules that keep tables and headings from being orphaned across page breaks.
CSS = """
body { font-family: Georgia, 'Times New Roman', serif; font-size: 10.5pt;
       line-height: 1.42; color: #1a1a1a; max-width: 48rem; }
h1 { font-size: 22pt; margin: 0 0 0.25rem; color: #0f2e1f;
     text-align: center; page-break-after: avoid; }
h2 { font-size: 14pt; margin: 0 0 0.45rem; color: #0f2e1f;
     page-break-after: avoid; page-break-before: always; }
h3 { font-size: 11.5pt; margin: 0.8rem 0 0.3rem; color: #1f3a2a;
     page-break-after: avoid; }
p { margin: 0.35rem 0; orphans: 2; widows: 2; }
em { color: #1a1a1a; font-style: italic; }
strong { color: #0f2e1f; }
blockquote { margin: 0.5rem 0 0.5rem 0.6rem; padding: 0 0.6rem;
             color: #2d4a38; font-style: italic;
             page-break-inside: avoid; }
code { font-family: Menlo, 'Courier New', monospace; font-size: 9.5pt;
       background: #f3f5f4; padding: 0.05rem 0.25rem; border-radius: 3px; }
ul, ol { margin: 0.3rem 0 0.45rem 1.3rem; padding: 0; }
li { margin: 0.15rem 0; page-break-inside: avoid; }
table { border-collapse: collapse; width: 100%; margin: 0.6rem 0;
        font-size: 9.5pt; page-break-inside: avoid; }
tr { page-break-inside: avoid; }
th, td { border: 1px solid #c5ccc7; padding: 0.3rem 0.5rem;
         text-align: left; vertical-align: top; }
th { background: #f0f4f1; color: #0f2e1f; }
hr { display: none; }
img { max-width: 200px; display: block; margin: 0 auto 0.8rem; }
sub { font-size: 9pt; color: #5a6b62; }
a { color: #0f2e1f; text-decoration: underline; }
"""


def _inline_image(src: str, base_dir: Path) -> str:
    """Read a local image file and return a base64 data URI."""
    if src.startswith(("http://", "https://", "data:")):
        return src
    if src.startswith("file://"):
        src = src[len("file://"):]
    path = (base_dir / src).resolve()
    if not path.exists():
        print(f"  WARN: image not found: {path}", file=sys.stderr)
        return src
    mime, _ = mimetypes.guess_type(str(path))
    if not mime:
        mime = "image/png"
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def resolve_images(md_text: str, base_dir: Path) -> str:
    """
    Inline every local image as a base64 data URI. Bypasses all path-
    resolution issues in the PDF engine. Works for both HTML <img> tags
    and markdown ![alt](src) images.
    """
    def html_sub(match: re.Match) -> str:
        prefix, src, suffix = match.group(1), match.group(2), match.group(3)
        return f'{prefix}{_inline_image(src, base_dir)}{suffix}'

    md_text = re.sub(
        r'(<img\s+[^>]*src=")([^"]+)(")',
        html_sub,
        md_text,
        flags=re.IGNORECASE,
    )

    def md_sub(match: re.Match) -> str:
        alt, src = match.group(1), match.group(2)
        return f'![{alt}]({_inline_image(src, base_dir)})'

    md_text = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', md_sub, md_text)
    return md_text


def stamp_footer(pdf_path: Path, text: str = "\u00a9 2026 General Liquidity, Inc.") -> None:
    """Stamp a centered footer on every page of the PDF in-place."""
    doc = fitz.open(str(pdf_path))
    for page in doc:
        r = page.rect
        footer_rect = fitz.Rect(r.x0 + 60, r.y1 - 36, r.x1 - 60, r.y1 - 18)
        page.insert_textbox(
            footer_rect,
            text,
            fontsize=8,
            fontname="helv",
            color=(0.35, 0.42, 0.38),
            align=1,  # center
        )
    doc.save(str(pdf_path), incremental=True, encryption=fitz.PDF_ENCRYPT_KEEP)
    doc.close()


def build_pdf(md_path: Path, pdf_path: Path, title: str) -> None:
    md_text = md_path.read_text(encoding="utf-8")
    md_text = resolve_images(md_text, md_path.parent)

    # Replace typographic dashes with HTML entities so PyMuPDF renders them
    # reliably regardless of which font glyphs are embedded.
    md_text = md_text.replace("\u2014", "&mdash;").replace("\u2013", "&ndash;")

    # Strip the trailing copyright div — the footer stamp covers every page.
    md_text = re.sub(
        r'\n*<div align="center">\s*<sub>[^<]*</sub>\s*</div>\s*$',
        "",
        md_text,
        flags=re.DOTALL,
    )

    # PyMuPDF ignores the deprecated align="center" HTML attribute; replace
    # it with an inline style so the cover page centers correctly.
    md_text = md_text.replace(
        '<div align="center">',
        '<div style="text-align:center;">'
    )

    # Upsize the tagline on the cover page.
    md_text = md_text.replace(
        "**Pioneering agentic vibe trading.**",
        '<p style="font-size:15pt;font-weight:bold;text-align:center;">'
        "Pioneering agentic vibe trading.</p>"
    )

    # Stack the founder contact block as a column (name / title / email).
    # Without explicit <br/> the markdown renderer collapses the three lines
    # into a single inline run.
    md_text = re.sub(
        r"Tiberiu Toca\nFounder, CEO\ncontact@generalliquidity\.com",
        '<p style="text-align:center;line-height:2.2;margin-top:0.6rem;">'
        "Tiberiu Toca<br/>Founder, CEO<br/>contact@generalliquidity.com</p>",
        md_text,
    )

    # toc_level=0 avoids the "hierarchy level must be 1" crash when the
    # document opens with an HTML <div> block instead of a bare heading.
    # mode='gfm-like' enables the GFM table extension so | --- | separator
    # rows are parsed as tables rather than rendered as literal dashes.
    pdf = MarkdownPdf(toc_level=0, mode="gfm-like", optimize=True)
    pdf.meta["title"] = title
    pdf.meta["author"] = "General Liquidity, Inc."

    pdf.add_section(Section(md_text, toc=False, paper_size="Letter"), user_css=CSS)

    # Write to a tempfile in the same directory, then atomic-rename. This
    # avoids "cannot remove file: Permission denied" when the target PDF is
    # open in a viewer (common on Windows). If the rename still fails, we
    # fall through with the tempfile preserved so the user can swap manually.
    tmp_path = pdf_path.with_suffix(pdf_path.suffix + ".tmp")
    pdf.save(tmp_path)
    stamp_footer(tmp_path)
    try:
        os.replace(tmp_path, pdf_path)
    except PermissionError:
        print(f"  NOTE: {pdf_path.name} is locked (open in a viewer).",
              file=sys.stderr)
        print(f"  Wrote to {tmp_path.name} instead. Close the viewer and "
              f"rename manually, or rerun this script.", file=sys.stderr)


def main() -> int:
    jobs = [
        (HERE / "general-liquidity-company-brief.md",
         HERE / "general-liquidity-company-brief.pdf",
         "General Liquidity — Company Brief"),
        (HERE / "general-liquidity-company-brief-v2.md",
         HERE / "general-liquidity-company-brief-v2.pdf",
         "General Liquidity — Company Brief (v2)"),
    ]
    for md_path, pdf_path, title in jobs:
        if not md_path.exists():
            print(f"SKIP (missing): {md_path.name}", file=sys.stderr)
            continue
        print(f"Building: {md_path.name} -> {pdf_path.name}")
        build_pdf(md_path, pdf_path, title)
        size_kb = pdf_path.stat().st_size / 1024
        print(f"  OK ({size_kb:.1f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
