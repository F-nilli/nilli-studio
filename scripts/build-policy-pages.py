"""Render the two reviewed Markdown documents as dependency-free static pages.

Supports only the headings, paragraphs, lists, tables and inline markup used
by these documents. No Markdown HTML is passed through. Run from any directory.
"""
from pathlib import Path
from html import escape
import re

ROOT = Path(__file__).resolve().parents[1]


def inline(text):
    text = escape(text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'(https://[^\s<>]+?)([.,]?)(?=\s|$)', r'<a href="\1">\1</a>\2', text)
    return text


def render(text):
    lines = text.splitlines()
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith('#'):
            level = len(line) - len(line.lstrip('#'))
            out.append(f'<h{level}>{inline(line[level:].strip())}</h{level}>')
            i += 1
        elif line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                if not re.match(r'^\|[\s:|\-]+$', lines[i]):
                    rows.append([inline(c.strip()) for c in lines[i].strip('|').split('|')])
                i += 1
            header = ''.join(f'<th scope="col">{c}</th>' for c in rows[0])
            body = ''.join('<tr>'+''.join(f'<td>{c}</td>' for c in row)+'</tr>' for row in rows[1:])
            out.append(f'<div class="table"><table><thead><tr>{header}</tr></thead><tbody>{body}</tbody></table></div>')
        elif line.startswith('- '):
            items = []
            while i < len(lines) and lines[i].startswith('- '):
                items.append('<li>'+inline(lines[i][2:])+'</li>')
                i += 1
            out.append('<ul>'+''.join(items)+'</ul>')
        else:
            paragraph = []
            while i < len(lines) and lines[i].strip() and not lines[i].startswith(('#','|','- ')):
                paragraph.append(inline(lines[i].rstrip()) + ('<br>' if lines[i].endswith('  ') else ' '))
                i += 1
            out.append('<p>'+''.join(paragraph).strip()+'</p>')
    return '\n'.join(out)


for slug, title in [('terms', 'End-User Agreement'), ('privacy', 'Privacy Policy')]:
    content = render((ROOT / 'docs/legal' / f'{slug}.md').read_text())
    page = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>{title} | Nilli Studio</title>
<link rel="stylesheet" href="policy.css"></head>
<body><a class="skip" href="#policy">Skip to policy</a>
<header><img src="logo.png" alt="Nilli Studio" width="140">
<nav aria-label="Legal pages"><a href="terms.html">Terms</a><a href="privacy.html">Privacy</a><a href="mailto:info@nillistudio.com">Contact</a></nav></header>
<main id="policy">{content}</main>
<footer>Nilli Studio Inc. · <a href="mailto:info@nillistudio.com">info@nillistudio.com</a></footer>
</body></html>'''
    (ROOT / 'public/legal' / f'{slug}.html').write_text(page)
