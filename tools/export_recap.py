#!/usr/bin/env python3
"""Export this month's recap as data for the Barsol Lookup / Barsol Rep App "Market Recap" tab.

    python3 tools/export_recap.py                 # writes market_recap.json next to index.html
    python3 tools/export_recap.py out.json

Reads index.html (topics, trends, one-liners, affected products, bottom line, full detail) and
tools/market_rules.json (which sales-analysis products belong to each topic). Needs beautifulsoup4.
The output is the single line that goes into the app as `const MARKET_RECAP = ...;`.
It holds recap text only. Customer data never goes in this repo.
"""
import json, os, re, sys
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'market_recap.json')

html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
rules = json.load(open(os.path.join(ROOT, 'tools', 'market_rules.json'), encoding='utf-8'))['topics']
s = BeautifulSoup(html, 'html.parser')

title = re.search(r'<title>[^<]*?([A-Za-z]+ \d{4})</title>', html)
upd = re.search(r'Updated\s+(\d+)\s*/\s*(\d+)\s*/\s*(\d+)', html)
month = title.group(1) if title else ''
updated = f'{int(upd.group(1))}/{int(upd.group(2))}/{upd.group(3)}' if upd else ''

topics, cat = [], ''
for el in s.select('.section-label, .product-row[data-trend]'):
    if 'section-label' in el.get('class', []):
        cat = re.sub(r'(Expand|Collapse) this category', '', el.get_text(' ', strip=True)).strip()
        continue
    def text(sel):
        n = el.select_one(sel)
        return n.get_text(' ', strip=True) if n else ''
    syn = el.select_one('.synopsis')
    bottom = syn.get_text(' ', strip=True).replace('\U0001F4CB', '').replace('Bottom Line', '', 1).strip() if syn else ''
    name = text('.product-name')
    t = {'cat': cat, 'name': name, 'trend': el['data-trend'], 'line': el.get('data-line', ''),
         'tags': [x.get_text(strip=True) for x in el.select('.product-tag')], 'bottom': bottom, 'detail': text('.full-detail-text')}
    r = rules.get(name, {})
    if 'feed' in r: t['feed'] = r['feed']
    elif 're' in r: t['re'] = r['re']
    topics.append(t)

missing = [t['name'] for t in topics if t['name'] not in rules]
if missing:
    print('warning: no product rule for', ', '.join(missing), '(add them to tools/market_rules.json)', file=sys.stderr)

data = {'month': month, 'updated': updated, 'topics': topics}
json.dump(data, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f'{len(topics)} topics, {month}, updated {updated} -> {out_path}')
