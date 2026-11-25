#!/usr/bin/env python3
"""Put this month's recap into the live Barsol Lookup page (the Market Recap tab).

    python3 tools/export_recap.py market_recap.json            # 1. this month's recap as data
    python3 tools/swap_recap_in_app.py <live index.html> market_recap.json <out_dir>

<live index.html> is the page as saved by an Artifact read of Barsol Lookup (the full page).
Writes <out_dir>/app_full.html (feed this to the rep app build) and <out_dir>/app_publish.html
(publish this to Barsol Lookup; the platform adds the page wrapper itself).
Only the one `const MARKET_RECAP = ...;` line changes. Customer data is never touched.
"""
import json, os, re, sys
live, recap, out = sys.argv[1:4]
s = open(live, encoding='utf-8').read()
data = json.load(open(recap, encoding='utf-8'))
line = 'const MARKET_RECAP = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c') + ';'
s, n = re.subn(r'^const MARKET_RECAP = .+;[ \t]*$', lambda m: line, s, count=1, flags=re.M)
if n != 1:
    sys.exit('Could not find the MARKET_RECAP line. Is the Market Recap tab in this page?')
os.makedirs(out, exist_ok=True)
open(os.path.join(out, 'app_full.html'), 'w', encoding='utf-8').write(s)
a = s.index('<body>') + len('<body>\n'); b = s.rindex('</body></html>')
open(os.path.join(out, 'app_publish.html'), 'w', encoding='utf-8').write(s[a:b])
print('recap swapped in:', data.get('month'), '(updated', data.get('updated') + ')')
