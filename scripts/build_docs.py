#!/usr/bin/env python3
"""Markdown (with YAML front-matter) -> styled HTML with cover page and table of contents.

Used by scripts/build_docs.sh, which prints the HTML to PDF with Playwright Chromium (page numbers in the footer).
  python scripts/build_docs.py docs/TECHNICAL_DOCUMENTATION.md out.html
"""
from __future__ import annotations

import html
import re
import sys
from pathlib import Path

import markdown
import yaml

CSS = """
@page { size: A4; margin: 18mm 17mm 20mm 17mm; }
:root { --brand: #0ea5a0; --indigo: #6366f1; --ink: #0b1220; --muted: #5b6577; --border: #e3e7ef; --soft: #f6f7fb; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Inter, "Segoe UI", Helvetica, Arial, sans-serif; color: var(--ink); font-size: 10.2pt; line-height: 1.55; margin: 0; }
.cover { height: 257mm; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always;
  padding: 26mm 14mm 14mm; border-radius: 6mm; color: #fff;
  background: radial-gradient(120% 80% at 100% 0%, rgba(99,102,241,.9) 0%, rgba(99,102,241,0) 60%), linear-gradient(140deg, #0b1220 0%, #0d6a69 60%, #0ea5a0 100%); }
.cover .mark { width: 18mm; height: 18mm; border-radius: 5mm; background: linear-gradient(135deg,#0ea5a0,#6366f1); display: grid; place-items: center;
  font: 700 26pt "Space Grotesk", Inter, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.25); }
.cover .kicker { margin-top: 14mm; letter-spacing: .18em; text-transform: uppercase; font-size: 9pt; opacity: .85; }
.cover h1.title { font: 700 30pt/1.15 "Space Grotesk", Inter, sans-serif; margin: 4mm 0 5mm; padding: 0; border: 0; color: #fff; page-break-before: avoid; }
.cover .subtitle { font-size: 12.5pt; max-width: 150mm; opacity: .92; }
.cover .meta { font-size: 10pt; opacity: .95; border-top: 1px solid rgba(255,255,255,.35); padding-top: 6mm; }
.cover .meta b { font-weight: 600; }
.cover .disclaimer { font-size: 8.5pt; opacity: .75; margin-top: 3mm; }
.toc-page { page-break-after: always; }
.toc-page h2 { border: 0; margin-top: 0; }
.toc ul { list-style: none; padding-left: 0; margin: 0; }
.toc > ul > li { margin: 1.4mm 0; font-weight: 600; font-size: 9.6pt; }
.toc ul ul { padding-left: 6mm; font-weight: 400; color: var(--muted); }
.toc ul ul { columns: 2; column-gap: 8mm; }
.toc ul ul li { margin: .4mm 0; font-size: 8.6pt; break-inside: avoid; }
.toc a { color: inherit; text-decoration: none; }
h1, h2, h3 { font-family: "Space Grotesk", Inter, sans-serif; color: var(--ink); line-height: 1.25; }
h1 { font-size: 17pt; margin: 9mm 0 4mm; padding-bottom: 2mm; border-bottom: 2px solid var(--brand); }
main > h1:first-child { margin-top: 0; }
div[style*="page-break-before"] + h1 { margin-top: 0; }
h2 { font-size: 13pt; margin: 7mm 0 2.5mm; }
h3 { font-size: 11pt; margin: 5mm 0 2mm; color: #0d6a69; }
h1, h2, h3 { page-break-after: avoid; }
p, li { orphans: 3; widows: 3; }
a { color: #0b8582; }
code { font-family: "JetBrains Mono", ui-monospace, Menlo, monospace; font-size: 8.6pt; background: var(--soft); border: 1px solid var(--border); border-radius: 3px; padding: 0 3px; }
pre { background: #0b1220; color: #e6eaf2; border-radius: 3mm; padding: 4mm; font-size: 8.2pt; line-height: 1.45; overflow-wrap: anywhere; white-space: pre-wrap; page-break-inside: avoid; }
pre code { background: none; border: 0; color: inherit; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 3mm 0 4mm; font-size: 8.8pt; page-break-inside: auto; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th { background: #ecfdfb; color: #105555; text-align: left; font-weight: 600; }
th, td { border: 1px solid var(--border); padding: 1.6mm 2.2mm; vertical-align: top; }
tbody tr:nth-child(even) td { background: #fafbfd; }
img { max-width: 100%; display: block; margin: 3mm auto; border-radius: 2mm; page-break-inside: avoid; }
img.shot { border: 1px solid var(--border); box-shadow: 0 2px 10px rgba(11,18,32,.08); }
blockquote { margin: 3mm 0; padding: 2mm 4mm; border-left: 3px solid var(--brand); background: var(--soft); color: #334155; }
hr { border: 0; border-top: 1px solid var(--border); margin: 6mm 0; }
.figure-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 5mm; }
.figure-grid p { margin: 0; font-size: 8.6pt; color: var(--muted); text-align: center; }
.figure-grid img { margin: 0 auto 1mm; }
"""


def split_front_matter(text: str) -> tuple[dict, str]:
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}, text
    return yaml.safe_load(m.group(1)) or {}, text[m.end():]


def render(md_path: Path, out_html: Path) -> None:
    meta, body = split_front_matter(md_path.read_text())
    md = markdown.Markdown(extensions=["tables", "fenced_code", "toc", "attr_list", "sane_lists", "md_in_html"], extension_configs={"toc": {"toc_depth": "1-2"}})
    content = md.convert(body).replace("<!-- pagebreak -->", '<div style="page-break-before: always"></div>')
    base = md_path.parent.resolve()
    content = re.sub(r'src="(?!https?:|file:|data:)([^"]+)"', lambda m: f'src="{(base / m.group(1)).resolve().as_uri()}"', content)
    content = content.replace('src="file://' + str((base / "../evidence/screenshots").resolve()), 'class="shot" src="file://' + str((base / "../evidence/screenshots").resolve()))
    title = meta.get("title", md_path.stem.replace("_", " ").title())
    author = html.escape(re.sub(r"^Team Git Push Pray\s*[—-]\s*", "", str(meta.get("author", ""))))
    cover = f"""
<section class="cover">
  <div>
    <div class="mark">R</div>
    <div class="kicker">FinTechathon 2026 · International Track · Topic C</div>
    <h1 class="title">{html.escape(title)}</h1>
    <div class="subtitle">{html.escape(str(meta.get("subtitle", "")))}</div>
  </div>
  <div class="meta">
    <div><b>Team Git Push Pray</b></div>
    <div>{author}</div>
    <div>{html.escape(str(meta.get("date", "")))} · github.com/sakib-101-git/remi</div>
    <div class="disclaimer">Sandbox demo. All banks, providers and universities are fictional. Not financial, legal or tax advice.</div>
  </div>
</section>"""
    toc = f'<section class="toc-page"><h2>Contents</h2><div class="toc">{md.toc_tokens and md.toc}</div></section>'
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
<style>{CSS}</style></head><body>{cover}{toc}<main>{content}</main></body></html>"""
    out_html.write_text(page)


if __name__ == "__main__":
    render(Path(sys.argv[1]), Path(sys.argv[2]))
