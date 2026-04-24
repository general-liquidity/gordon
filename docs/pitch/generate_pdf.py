#!/usr/bin/env python3
"""Generate a formatted PDF from general-liquidity-company-brief-v3.md"""

import re
import base64
from pathlib import Path
from markdown_pdf import MarkdownPdf, Section

# ── paths ────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent
MD_PATH = ROOT / "general-liquidity-company-brief-v3.md"
PDF_PATH = ROOT / "general-liquidity-company-brief-v3.pdf"
LOGO_PATH = (ROOT / ".." / ".." / "general-liquidity-website" / "public" / "logo.png").resolve()

# Encode logo as base64 data URI for reliable embedding
_logo_b64 = base64.b64encode(LOGO_PATH.read_bytes()).decode("utf-8")
LOGO_SRC = f"data:image/png;base64,{_logo_b64}"

# ── read source ───────────────────────────────────────────────────────────────
raw = MD_PATH.read_text(encoding="utf-8")

# ── pre-process markdown ──────────────────────────────────────────────────────
text = raw.replace("<!-- prettier-ignore -->", "")

# Replace typographic dashes with HTML entities for reliable PDF rendering
text = text.replace("\u2014", "&mdash;").replace("\u2013", "&ndash;")

# Replace the HTML div header block — preserve logo using absolute path
header_pattern = re.compile(r'<div align="center">.*?</div>', re.DOTALL)

def build_header(m):
    return (
        "\n\n"
        f'<div align="center"><img src="{LOGO_SRC}" height="120" /><br/><br/>'
        "<strong style=\"font-size:22pt;font-family:sans-serif;\">General Liquidity</strong><br/><br/>"
        "<em>Trade with discipline. Not willpower.</em><br/><br/>"
        "contact@generalliquidity.com</div>\n\n---\n\n"
    )

text = header_pattern.sub(build_header, text, count=1)

# Remove trailing footer div
text = re.sub(r'<div align="center">\s*<sub>.*?</sub>\s*</div>',
              "\n\n---\n\n*© 2026 General Liquidity, Inc.*\n",
              text, flags=re.DOTALL)

# ── custom CSS ────────────────────────────────────────────────────────────────
CSS = """
/* Page & base */
@page {
    size: A4;
    margin: 52px 60px 52px 60px;
}

body {
    font-family: "Georgia", "Times New Roman", serif;
    font-size: 10.5pt;
    line-height: 1.65;
    color: #1a1a1a;
    max-width: 100%;
}

/* Headings */
h1 {
    font-family: "Helvetica Neue", "Arial", sans-serif;
    font-size: 22pt;
    font-weight: 700;
    color: #0a0a0a;
    margin-top: 0;
    margin-bottom: 6px;
    border-bottom: 3px solid #0a0a0a;
    padding-bottom: 8px;
    letter-spacing: -0.5px;
}

h2 {
    font-family: "Helvetica Neue", "Arial", sans-serif;
    font-size: 14pt;
    font-weight: 700;
    color: #1a1a1a;
    margin-top: 28px;
    margin-bottom: 8px;
    border-bottom: 1.5px solid #cccccc;
    padding-bottom: 4px;
    letter-spacing: -0.3px;
    page-break-after: avoid;
}

h3 {
    font-family: "Helvetica Neue", "Arial", sans-serif;
    font-size: 11.5pt;
    font-weight: 700;
    color: #1a1a1a;
    margin-top: 20px;
    margin-bottom: 4px;
    page-break-after: avoid;
}

h4 {
    font-family: "Helvetica Neue", "Arial", sans-serif;
    font-size: 10.5pt;
    font-weight: 700;
    font-style: italic;
    color: #333333;
    margin-top: 14px;
    margin-bottom: 3px;
    page-break-after: avoid;
}

/* Paragraphs */
p {
    margin-top: 0;
    margin-bottom: 10px;
    orphans: 3;
    widows: 3;
}

/* Bold & italic */
strong {
    font-weight: 700;
    color: #0a0a0a;
}

em {
    font-style: italic;
    color: #1a1a1a;
}

/* Horizontal rule */
hr {
    border: none;
    border-top: 1px solid #dddddd;
    margin: 20px 0;
}

/* Tables */
table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
    margin: 14px 0;
    page-break-inside: avoid;
}

thead {
    background-color: #1a1a1a;
    color: #ffffff;
}

thead th {
    padding: 7px 10px;
    font-family: "Helvetica Neue", "Arial", sans-serif;
    font-weight: 700;
    text-align: left;
    font-size: 9pt;
    letter-spacing: 0.3px;
}

tbody tr:nth-child(even) {
    background-color: #f7f7f7;
}

tbody tr:nth-child(odd) {
    background-color: #ffffff;
}

td {
    padding: 6px 10px;
    border-bottom: 1px solid #e0e0e0;
    vertical-align: top;
    line-height: 1.5;
}

/* Code blocks */
pre {
    background-color: #f4f4f4;
    border: 1px solid #dddddd;
    border-left: 4px solid #1a1a1a;
    padding: 12px 14px;
    font-family: "Courier New", "Courier", monospace;
    font-size: 8.5pt;
    line-height: 1.5;
    overflow-x: auto;
    white-space: pre-wrap;
    word-wrap: break-word;
    page-break-inside: avoid;
    margin: 12px 0;
}

code {
    font-family: "Courier New", "Courier", monospace;
    font-size: 9pt;
    background-color: #f0f0f0;
    padding: 1px 4px;
    border-radius: 3px;
    color: #1a1a1a;
}

pre code {
    background: none;
    padding: 0;
    font-size: 8.5pt;
}

/* Lists */
ul, ol {
    margin: 6px 0 10px 0;
    padding-left: 22px;
}

li {
    margin-bottom: 3px;
    line-height: 1.55;
}

li > ul, li > ol {
    margin-top: 3px;
    margin-bottom: 3px;
}

/* Blockquote */
blockquote {
    border-left: 4px solid #cccccc;
    margin: 12px 0;
    padding: 8px 16px;
    color: #444444;
    font-style: italic;
    background-color: #fafafa;
}

blockquote p {
    margin: 0;
}

/* Title page first H1 */
h1:first-of-type {
    font-size: 26pt;
    margin-top: 40px;
    border-bottom: 4px solid #0a0a0a;
}
"""

# ── build PDF ─────────────────────────────────────────────────────────────────
pdf = MarkdownPdf(toc_level=0, mode='gfm-like')

# Single section — the whole document
section = Section(
    text,
    toc=False,
    paper_size="A4",
    borders=(52, 60, -52, -60)
)

pdf.add_section(section, user_css=CSS)
pdf.meta["title"] = "General Liquidity - Company Brief v3"
pdf.meta["author"] = "General Liquidity"
pdf.meta["subject"] = "Agentic Vibe Trading Terminal"
pdf.meta["keywords"] = "agentic trading, vibe trading, retail operator, General Liquidity, Gordon"

pdf.save(str(PDF_PATH))
print(f"PDF saved to: {PDF_PATH}")
print(f"File size: {PDF_PATH.stat().st_size / 1024:.1f} KB")
