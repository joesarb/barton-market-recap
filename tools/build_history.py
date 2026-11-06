#!/usr/bin/env python3
"""Fill in each product's trend history on index.html from the archived months.

Run each month AFTER archive_month.py and AFTER the new month's index.html is in place:

    python3 tools/archive_month.py        # 1. save the month being replaced
    # ... update index.html with the new month ...
    python3 tools/build_history.py        # 2. refresh the trend strips

It reads archive/index.json, takes the last 6 archived months, looks up each product's trend on those archived
pages, and writes data-history="t1,t2,..." (oldest first) on every product row plus a <meta name="history-months">
list of month labels. The page adds the current month itself. A product missing from an old page shows as "?".
"""
import html, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
KEEP = 6

ROW_NAME = re.compile(r'<div class="product-row trend-[a-z-]+[^"]*" data-trend="([a-z-]+)"[^>]*>\s*<div class="product-row-header".*?<div class="product-name">([^<]+)</div>', re.S)


def trends(path):
    t = open(os.path.join(ROOT, path), encoding='utf-8').read()
    return {html.unescape(m.group(2)).strip(): m.group(1) for m in ROW_NAME.finditer(t)}


def main():
    idx = sorted(json.load(open(os.path.join(ROOT, 'archive', 'index.json'))), key=lambda e: e['id'])[-KEEP:]
    months = [MON[int(e['updated'].split('/')[0]) - 1] for e in idx]
    past = [trends(e['path']) for e in idx]

    page_path = os.path.join(ROOT, 'index.html')
    page = open(page_path, encoding='utf-8').read()

    def set_attr(m):
        name = html.unescape(m.group(3)).strip()
        hist = ','.join(p.get(name, '?') for p in past)
        tag = re.sub(r'\s+data-history="[^"]*"', '', m.group(1))
        return f'{tag} data-history="{hist}"{m.group(2)}{m.group(3)}{m.group(4)}'

    page, n = re.subn(r'(<div class="product-row trend-[a-z-]+" data-trend="[a-z-]+"[^>]*?)(>\s*<div class="product-row-header"[^>]*>\s*<div class="product-name">)([^<]+)(</div>)',
                      set_attr, page)
    meta = f'<meta name="history-months" content="{",".join(months)}">'
    if 'name="history-months"' in page:
        page = re.sub(r'<meta name="history-months"[^>]*>', meta, page, count=1)
    else:
        page = page.replace('</head>', meta + '\n</head>', 1)
    open(page_path, 'w', encoding='utf-8').write(page)
    print(f'updated {n} products; months: {", ".join(months)}')


if __name__ == '__main__':
    main()
