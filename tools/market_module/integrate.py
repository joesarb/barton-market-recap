#!/usr/bin/env python3
"""Patch the live Barsol Lookup page with the Market Recap tab.
   usage: integrate.py <live_full.html> <market_recap.json> <mk_module.js> <out_full.html> <out_publish.html>"""
import json, sys
live, recap, mod, out_full, out_pub = sys.argv[1:6]
s = open(live, encoding='utf-8').read()
def rep(old, new):
    global s
    assert s.count(old) == 1, ('anchor count', s.count(old), old[:80]); s = s.replace(old, new)

# 1. views map
rep("lookup:'view-lookup', intel:'view-intel'};", "lookup:'view-lookup', intel:'view-intel', market:'view-market'};")
# 2. nav button
rep('<button class="navbtn" data-nav="priceletters">Price Letters</button>',
    '<button class="navbtn" data-nav="priceletters">Price Letters</button>\n    <button class="navbtn" data-nav="market">Market Recap</button>')
# 3. home card (before the placeholder card)
card = '''      <button class="tool-card" data-nav="market">
        <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-5 4 4 8-9"/><path d="M15 7h5v5"/></svg></div>
        <h3>Market Recap</h3>
        <p>The monthly chemical market recap with the customers it affects. See the most impacted customers per topic, build a quick brief before a meeting, and spot flagged accounts.</p>
        <div class="stat"><span>Matched to your sales analysis</span><b id="home-stat-market">&mdash;</b></div>
      </button>
'''
rep('      <div class="tool-card future">', card + '      <div class="tool-card future">')
# 4. the view
view = '''  <!-- ================= MARKET RECAP ================= -->
  <section id="view-market" class="view hidden">
    <div class="page-head">
      <div class="breadcrumb"><button data-nav="home">Home</button> <span>/</span> <span>Market Recap</span></div>
      <h2>Market Recap</h2>
      <div class="sub" id="mk-sub"></div>
    </div>
    <div id="mk-host"></div>
  </section>

'''
rep('  <!-- ================= PRICING ================= -->', view + '  <!-- ================= PRICING ================= -->')
# 5. data + module at the end of the last script
data = json.load(open(recap, encoding='utf-8'))
line = 'const MARKET_RECAP = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c') + ';\n'
code = open(mod, encoding='utf-8').read()
mi = s.find('<script>\n/* ---------------- Market Intel')
i = s.rindex('</script>', 0, mi) if mi >= 0 else s.rindex('</script>')   # keep this tab out of the Market Intel script block
s = s[:i] + '\n/* ---------------- Market Recap tab ---------------- */\n' + line + code + s[i:]
open(out_full, 'w', encoding='utf-8').write(s)
# publish version: the platform adds the page skeleton itself
a = s.index('<body>') + len('<body>\n'); b = s.rindex('</body></html>')
open(out_pub, 'w', encoding='utf-8').write(s[a:b])
print('full', len(s), 'publish', b - a)
