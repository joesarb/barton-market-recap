/* ---- Sales analysis PDF -> customers (runs in the browser; same code is tested in node) ---- */
const MK_SKIP = /drum|pail|pallet|tote|waste|fee|sludge|disposal|manifest|misc|container|freight|labor|deposit|surcharge|solid|bottoms|liquids|transprtn|rinse|hazard|handling|compound waste|reclaim/i;
function mkPkgType(code){
  const suf = code.indexOf('-') >= 0 ? code.slice(code.indexOf('-') + 1) : '';
  if (/^(tot|tote|ft)/i.test(suf) || /^(350|330)/.test(suf)) return 'tote';   // FT = full truck, counted as totes
  if (/^bulk/i.test(suf)) return 'bulk';
  if (/^(55|30)/.test(suf)) return 'drum';
  if (/^5(sc|pc|fs)/i.test(suf)) return 'pail';
  if (/^40bag/i.test(suf)) return 'bag';
  if (/^(1|2)(sc|pc|qtc)/i.test(suf)) return 'small';
  return 'other';
}
const MK_NUM = s => parseFloat(String(s).replace(/,/g, ''));
const MK_LINE = /^(.+?) -- ([\d.,]+) (\S+) (\d+-\S+) ([\d.,]+) (\d{1,2}\/\d{1,2}\/\d{4}) ([\d.]+) (-?[\d,]+) (-?[\d,]+) (-?[\d,]+) (\S+) (-?[\d,]+\.\d\d) (-?[\d,]+\.\d\d) (\S+)/;
function mkParseSales(text){
  const raw = String(text).split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s && !/^--- Page \d+ ---$/.test(s));
  const out = {asOf: '', agent: '', um: '', customers: [], grand: null, mismatches: 0, lines: 0};
  let cur = null;
  for (const ln of raw) {
    let m;
    if ((m = ln.match(/^Date: (\d{1,2})\/(\d{1,2})\/(\d{4})/)) && !out.asOf) { out.asOf = m[3] + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0'); continue; }
    if ((m = ln.match(/Report UM: (\S+)/))) { out.um = m[1]; continue; }
    if ((m = ln.match(/^Sales Agent ?: ?(?:\d+ - )?(.+)$/))) { out.agent = m[1].trim(); continue; }
    if (/^Subtotal for /.test(ln)) continue;   // the label can print before or after its numbers, so the numbers row is matched on its own
    if (cur && !/ -- /.test(ln) && (m = ln.match(/^-?[\d,]+ -?[\d,]+ -?[\d,]+ \S+ (-?[\d,]+\.\d\d) (-?[\d,]+\.\d\d) \S+$/))) { cur.sub = {dytd: MK_NUM(m[1]), dlytd: MK_NUM(m[2])}; continue; }
    if (/Grand Totals/.test(ln)) { out.grandSeen = true; }
    if ((m = ln.match(MK_LINE)) && cur) {
      const [, name, size, uom, code, price, last, , , ytd, lytd, , dytd, dlytd] = m;
      const [mm, dd, yy] = last.split('/');
      cur.lines.push({n: name.trim(), code, size: MK_NUM(size), uom, ytd: MK_NUM(ytd), lytd: MK_NUM(lytd), dytd: MK_NUM(dytd), dlytd: MK_NUM(dlytd), last: yy + '-' + mm.padStart(2, '0') + '-' + dd.padStart(2, '0')});
      out.lines++; continue;
    }
    if ((m = ln.match(/^(\d+) - (.+)$/)) && !/ -- /.test(ln) && !/\d+\.\d\d$/.test(ln)) { cur = {id: m[1], c: m[2].trim(), lines: [], sub: null}; out.customers.push(cur); continue; }
    if (/\*+ END OF REPORT/.test(ln)) { cur = null; }
  }
  // grand totals: the two dollar figures printed near "Grand Totals"
  const gi = raw.findIndex(l => /Grand Totals/.test(l));
  if (gi >= 0) {
    const near = raw.slice(Math.max(0, gi - 2), gi + 3).join(' ');
    const d = near.match(/-?[\d,]+\.\d\d/g) || [];
    if (d.length >= 2) out.grand = {dytd: MK_NUM(d[d.length - 2]), dlytd: MK_NUM(d[d.length - 1])};
  }
  const tol = 1;
  out.customers.forEach(c => { if (c.sub && (Math.abs(c.lines.reduce((a, l) => a + l.dytd, 0) - c.sub.dytd) > tol || Math.abs(c.lines.reduce((a, l) => a + l.dlytd, 0) - c.sub.dlytd) > tol)) out.mismatches++; });
  out.verified = out.customers.filter(c => c.sub).length;
  out.sumYtd = out.customers.reduce((a, c) => a + c.lines.reduce((b, l) => b + l.dytd, 0), 0);
  out.sumLytd = out.customers.reduce((a, c) => a + c.lines.reduce((b, l) => b + l.dlytd, 0), 0);
  return out;
}
/* parsed lines -> compact per-customer product rows: [name, lbYTD, lbLY, $YTD, $LY, lastDate, [[pkg, lb, units]]] */
function mkCompact(parsed){
  const res = [];
  parsed.customers.forEach(c => {
    const agg = {};
    c.lines.forEach(p => {
      if (MK_SKIP.test(p.n) || (p.dytd === 0 && p.dlytd === 0)) return;
      const a = agg[p.n] || (agg[p.n] = {n: p.n, y: 0, l: 0, yd: 0, ld: 0, last: '', pkY: {}, pkL: {}});
      a.y += p.ytd; a.l += p.lytd; a.yd += p.dytd; a.ld += p.dlytd;
      if (!a.last || p.last > a.last) a.last = p.last;
      const t = mkPkgType(p.code);
      [['pkY', p.ytd], ['pkL', p.lytd]].forEach(([k, q]) => { if (q > 0) { const e = a[k][t] || (a[k][t] = [0, 0]); e[0] += q; e[1] += p.size > 1 ? q / p.size : 0; } });
    });
    const lines = Object.values(agg).map(a => {
      const basis = a.yd > 0 ? a.pkY : a.pkL;
      const pk = Object.entries(basis).map(([t, v]) => [t, Math.round(v[0]), Math.round(v[1])]).sort((x, y) => y[1] - x[1]);
      return [a.n, Math.round(a.y), Math.round(a.l), Math.round(a.yd), Math.round(a.ld), a.last, pk];
    });
    if (lines.length) res.push({c: c.c, l: lines});
  });
  return res;
}
/* read a PDF into text lines: group cells by row, then order each row left to right (pdf.js hands cells back in drawing order) */
async function mkReadPdfText(lib, file){
  const pdf = await lib.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    const items = tc.items.filter(it => it.str && it.str.trim() && it.transform).map(it => ({x: it.transform[4], y: it.transform[5], s: it.str.trim()}));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    items.forEach(it => { const r = rows[rows.length - 1]; if (r && Math.abs(r.y - it.y) <= 2.5) r.items.push(it); else rows.push({y: it.y, items: [it]}); });
    pages.push(rows.map(r => r.items.sort((a, b) => a.x - b.x).map(x => x.s).join(' ')).join('\n'));
  }
  return pages.join('\n');
}

(function(){
'use strict';
const host = document.getElementById('mk-host'); if (!host) return;
const root = host.attachShadow({mode: 'open'});
root.innerHTML = '<style>' + '\n:host{display:block}\n*{box-sizing:border-box}\n.mk{--sans:"Libre Franklin",-apple-system,"Segoe UI",sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;\n  --chrome:var(--chrome-text);--chrome-dim:var(--chrome-text-dim);--chrome-faint:var(--chrome-text-faint);\n  --t-up:#c0392b;--t-stable-up:#a05c00;--t-stable:#1e7a4a;--t-stable-down:#0e7c8a;--t-down:#185FA5;--t-volatile:#7d3c98;\n  font-family:var(--sans);font-size:15px;color:var(--text);-webkit-font-smoothing:antialiased}\n[hidden]{display:none !important}\nbutton,input{font-family:inherit;color:inherit}\nbutton:focus-visible,input:focus-visible,.card-h:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\n.mono{font-family:var(--mono)}\n/* sales analysis upload + empty states */\n.salesbar{display:flex;gap:8px 10px;align-items:center;flex-wrap:wrap;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:9px 12px;margin-bottom:12px;color:var(--text);font-size:13px;line-height:1.45}\n.salesbar .sb-t{flex:1 1 220px;min-width:0}\n.salesbar .ok{color:var(--t-stable);font-weight:700}\n.salesbar .warn{color:var(--amber);font-weight:700}\n.upl{background:var(--amber-tint);border:1px solid color-mix(in srgb,var(--amber) 30%,transparent);border-radius:10px;padding:14px;margin-bottom:12px;color:var(--text)}\n.upl b{display:block;font-size:15px;margin-bottom:4px}\n.upl p{margin:0 0 10px;font-size:13px;line-height:1.5;color:var(--text-dim)}\n.btn{border:0;border-radius:8px;background:var(--accent-fill);color:#fff;font-weight:700;font-size:13.5px;padding:10px 16px;cursor:pointer}\n.btn:disabled{opacity:.55;cursor:default}\n.err{background:#fbe9e6;border:1px solid #e3b1a8;color:#8a2a1c;border-radius:8px;padding:9px 12px;font-size:13px;line-height:1.45;margin-bottom:12px}\n.busy{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--chrome-dim);margin-bottom:12px}\n.spin{width:16px;height:16px;border:2px solid var(--border-strong);border-top-color:var(--accent);border-radius:50%;animation:mkspin .7s linear infinite;flex:none}\n@keyframes mkspin{to{transform:rotate(360deg)}}\n.nosales{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;font-size:14px;line-height:1.55;color:var(--text)}\n.nosales .btn{margin-top:10px}\n.cf{display:inline-flex;gap:8px;align-items:center;font-size:12.5px;color:var(--text-dim)}\n@media (prefers-reduced-motion:reduce){.spin{animation-duration:3s}}\n/* view switch + filters */\n.seg{display:flex;background:var(--surface);border:1px solid var(--border-strong);border-radius:999px;padding:3px;gap:3px;margin-bottom:12px;box-shadow:var(--shadow)}\n.seg button{flex:1 1 auto;white-space:nowrap;border:0;background:none;padding:9px 8px;border-radius:999px;font-weight:700;font-size:13.5px;color:var(--text-dim);cursor:pointer}\n.seg button[aria-selected="true"]{background:var(--accent-fill);color:#fff}\n.seg button{font-size:13px}\n.seg2{box-shadow:none}\n.fnote{font-size:12.5px;line-height:1.5;color:var(--chrome-dim);margin:0 0 10px}\n.fl-sub{grid-column:2 / -1;font-size:12.5px;color:var(--text-dim);line-height:1.45;margin-top:-2px}\n.frow{border-top:1px solid var(--border)}\n.frow:first-child{border-top:0}\n.frow .crow{border-top:0;padding-bottom:4px}\n.fl-act{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:0 0 10px 32px}\n.fl-act .mini{font-size:11.5px;padding:3px 9px;font-weight:600}\n.fl-q{font-size:12px;font-weight:700;color:var(--text-dim)}\n.acct{font-size:12px;color:var(--text-faint)}\n.hidbox{margin-top:14px}\n.hrow{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:9px 0;border-top:1px solid var(--border);font-size:13.5px;line-height:1.4}\n.hrow:first-child{border-top:0}\n.kb{display:inline-block;font:700 10px var(--sans);letter-spacing:.04em;text-transform:uppercase;padding:1px 6px;border-radius:5px;border:1px solid var(--border-strong);color:var(--text-dim);margin-right:6px;vertical-align:1px}\n.fl-sub .tpc{display:inline-block;margin-left:4px;font-weight:700;color:var(--text)}\n.chips{display:flex;gap:7px;overflow-x:auto;scrollbar-width:none;padding:2px 0 10px}\n.chips::-webkit-scrollbar{display:none}\n.chip{flex:none;border:1px solid var(--border-strong);background:var(--surface);color:var(--text-dim);padding:6px 11px;border-radius:999px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}\n.chip[aria-pressed="true"]{background:var(--accent-fill);border-color:var(--accent-fill);color:#fff}\n.bar-row{display:flex;align-items:center;gap:10px;margin:2px 0 8px;flex-wrap:wrap}\n.bar-row .count{font:500 12px var(--mono);color:var(--chrome-faint)}\n.bar-row .push{margin-left:auto;display:flex;gap:6px;align-items:center}\n.mini{border:1px solid var(--border-strong);background:var(--surface);color:var(--text-dim);border-radius:7px;font-size:12px;font-weight:700;padding:5px 10px;cursor:pointer}\n.mini:hover{border-color:var(--accent);color:var(--accent-strong)}\n.mini[aria-pressed="true"]{background:var(--accent-fill);border-color:var(--accent-fill);color:#fff}\n\n/* topic cards */\n.cat-label{margin:18px 0 8px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--chrome-dim)}\n.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow);margin-bottom:8px;overflow:hidden;color:var(--text)}\n.card-h{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;cursor:pointer;width:100%;border:0;background:none;text-align:left}\n.arrow{font-size:22px;line-height:1.1;flex:none;width:28px;text-align:center}\n.card-m{min-width:0;flex:1}\n.nm{font-weight:700;font-size:15px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}\n.badge{font:700 10.5px var(--sans);letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:999px;border:1px solid currentColor}\n.ln{font-size:13.5px;color:var(--text-dim);margin-top:3px;line-height:1.4}\n.tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}\n.tag{font-size:11.5px;font-weight:600;background:var(--surface-2);color:var(--text-dim);padding:2px 8px;border-radius:5px}\n.reach{font:500 11.5px var(--mono);color:var(--text-faint);margin-top:7px}\n.chev{flex:none;color:var(--text-faint);font-size:14px;transition:transform .15s;margin-top:4px}\n.card.open .chev{transform:rotate(180deg)}\n.card-b{display:none;padding:2px 14px 14px;border-top:1px dashed var(--border)}\n.card.open .card-b{display:block}\n.bl-h,.sec-h{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--accent-strong);margin:14px 0 6px;display:flex;align-items:center;gap:8px}\n.sec-h .mini{margin-left:auto;text-transform:none;letter-spacing:0}\n.bl{font-size:14px;line-height:1.6;max-width:70ch}\n.detail{font-size:13.5px;line-height:1.65;color:var(--text-dim);max-width:70ch;white-space:pre-wrap;margin-top:6px}\n.matched{font:500 11.5px/1.6 var(--mono);color:var(--text-faint);margin-top:10px}\n\n/* customer rows */\n.crows{display:flex;flex-direction:column}\n.crow{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:4px 10px;align-items:center;padding:9px 0;border-top:1px solid var(--border);width:100%;background:none;border-left:0;border-right:0;border-bottom:0;text-align:left;cursor:pointer}\n.crow:first-child{border-top:0}\n.crow:hover .cn{color:var(--accent-strong);text-decoration:underline}\n.rk{font:600 12px var(--mono);color:var(--text-faint)}\n.cn{font-weight:700;font-size:14px;overflow-wrap:anywhere}\n.cs{font:500 12px var(--mono);color:var(--text-dim);text-align:right;white-space:nowrap}\n.cs b{color:var(--text);font-weight:600}\n.cprods{grid-column:2 / -1;font-size:12.5px;color:var(--text-faint);margin-top:-2px}\n.delta{font:600 11.5px var(--mono);padding:1px 6px;border-radius:5px;background:var(--surface-2)}\n.delta.pos{color:var(--t-stable)}.delta.neg{color:var(--t-up)}.delta.new{color:var(--accent-strong);background:var(--accent-tint)}\n.empty{padding:14px 0;font-size:13.5px;color:var(--text-dim)}\n\n/* customer view */\n.search{position:relative;margin-bottom:10px}\n.search input{width:100%;padding-right:46px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);border-radius:10px;padding:13px 14px;font-size:16px;font-weight:500}\n.sugg{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:30;background:var(--surface);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);overflow:hidden;color:var(--text)}\n.sugg button{display:flex;justify-content:space-between;gap:10px;width:100%;text-align:left;border:0;border-bottom:1px solid var(--border);background:var(--surface);padding:11px 14px;font-size:14px;font-weight:600;cursor:pointer}\n.sugg button:last-child{border-bottom:0}\n.sugg button:hover{background:var(--surface-2)}\n.sugg .k{font:500 12px var(--mono);color:var(--text-faint);flex:none}\n.clr{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:32px;height:32px;border:0;border-radius:8px;background:var(--surface-2);color:var(--text-dim);cursor:pointer;font-size:14px;font-weight:700}\n.clr:hover{color:var(--accent-strong)}\n.b-top{display:flex;gap:10px;align-items:flex-start;justify-content:space-between}\n.nt{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-size:14px;line-height:1.55;color:var(--text)}\n.rd small{display:block;font-weight:500;color:var(--text-faint);font-size:12px;margin-top:1px}\n.rd .amt{text-align:right;white-space:normal}\n.try{font-size:12px;color:var(--chrome-faint);margin:0 0 6px}\n.brief{margin-top:14px;display:flex;flex-direction:column;gap:12px}\n.b-head{background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow);padding:14px;color:var(--text)}\n.b-head h3{margin:0 0 2px;font-size:19px;font-weight:800;letter-spacing:-.005em;overflow-wrap:anywhere}\n.b-sub{font-size:12.5px;color:var(--text-faint)}\n.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}\n.stat{background:var(--surface-2);border-radius:8px;padding:9px 10px;min-width:0}\n.stat .k{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-faint)}\n.stat .v{font:600 15px var(--mono);margin-top:3px;overflow-wrap:anywhere}\n.stat .v small{font-size:11px;color:var(--text-dim);font-weight:500}\n.pk{display:inline-block;font:600 11px var(--sans);padding:1px 7px;border-radius:5px;background:var(--surface-2);color:var(--text-dim);margin:4px 5px 0 0;border:1px solid var(--border)}\n.pk.flagged{background:var(--amber-tint);border-color:color-mix(in srgb,var(--amber) 35%,transparent);color:var(--amber)}\n.pks{display:block}\n.tp-pk{margin-top:8px;font-size:12.5px;color:var(--text-dim);line-height:1.5}\n.tp-pk .pk-n{font-weight:700;margin-right:4px;color:var(--text)}\n.flagcard{background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--amber);border-radius:10px;box-shadow:var(--shadow);padding:6px 14px;color:var(--text)}\n.flagcard div{padding:10px 0;border-top:1px solid var(--border);font-size:13.5px;line-height:1.55}\n.flagcard div:first-child{border-top:0}\n.top-prods{font-size:12.5px;color:var(--text-dim);margin-top:10px;line-height:1.5}\n.talk-h{display:flex;align-items:center;gap:10px;margin:6px 0 -2px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--chrome-dim)}\n.talk-h .mini{margin-left:auto;text-transform:none;letter-spacing:0}\n.tp{background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow);padding:13px 14px;color:var(--text);border-left:4px solid var(--tc,var(--border-strong))}\n.tp-top{display:flex;gap:9px;align-items:center;flex-wrap:wrap}\n.tp-n{font:700 12px var(--mono);color:var(--text-faint)}\n.tp-t{font-weight:800;font-size:15.5px}\n.tp-line{font-size:13.5px;color:var(--text-dim);margin:6px 0 0;line-height:1.5}\n.tp-why{font-size:13.5px;margin:8px 0 0;line-height:1.55}\n.tp-say{margin:10px 0 0;padding:9px 12px;background:var(--accent-tint);border-radius:8px;font-size:14px;line-height:1.5;font-style:italic;color:#12301f}\n.tp-say b{display:block;font:700 10px var(--sans);font-style:normal;letter-spacing:.07em;text-transform:uppercase;color:var(--accent-strong);margin-bottom:3px}\n.radar{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:6px 14px;color:var(--text)}\n.rd{display:flex;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--border);font-size:13.5px}\n.rd:first-child{border-top:0}\n.rd .nm2{flex:1;min-width:0;font-weight:600}\n.rd .amt{font:500 12px var(--mono);color:var(--text-dim);white-space:nowrap}\n.watch{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:6px 14px;color:var(--text);font-size:13.5px;line-height:1.5}\n.watch div{padding:9px 0;border-top:1px solid var(--border)}\n.watch div:first-child{border-top:0}\n.copybox{width:100%;min-height:150px;font:500 12.5px/1.5 var(--mono);border:1px solid var(--border-strong);border-radius:8px;padding:10px;background:var(--surface);color:var(--text);margin-top:8px}\n.foot{font-size:12px;color:var(--chrome-faint);line-height:1.5;margin-top:22px}\n@media (max-width:420px){.stats{grid-template-columns:1fr 1fr}.stat:last-child{grid-column:1/-1}.cs{font-size:11.5px}}\n@media (prefers-reduced-motion:reduce){.chev{transition:none}}\n' + '</style><div class="mk">' + '<div id="salesBar"></div>\n  <input type="file" id="salesFile" accept=".pdf,application/pdf" hidden>\n  <div class="seg" role="tablist">\n    <button id="t-topics" role="tab" aria-selected="true">Topics</button>\n    <button id="t-cust" role="tab" aria-selected="false">Customer brief</button>\n    <button id="t-flag" role="tab" aria-selected="false">Flagged accounts</button>\n  </div>\n\n  <section class="view" id="v-topics">\n    <div class="chips" id="trendChips" aria-label="Filter by trend"></div>\n    <div class="bar-row">\n      <span class="count" id="tcount"></span>\n      <span class="push"><span style="font-size:12px;color:var(--chrome-faint)">Customers shown</span>\n        <button class="mini" id="n3" aria-pressed="false" type="button">Top 3</button>\n        <button class="mini" id="n5" aria-pressed="true" type="button">Top 5</button>\n        <button class="mini" id="expAll" type="button">Expand all</button></span>\n    </div>\n    <div id="topics"></div>\n  </section>\n\n  <section class="view" id="v-flag" hidden>\n    <div class="nosales" id="gateFlag" hidden></div>\n    <div id="flagBody">\n    <div class="seg seg2" role="tablist">\n      <button id="f-bulk" role="tab" aria-selected="true"></button>\n      <button id="f-miss" role="tab" aria-selected="false"></button>\n    </div>\n    <div class="chips" id="missChips" hidden aria-label="Filter missed sales"></div>\n    <p class="fnote" id="fnote"></p>\n    <div id="flagList"></div>\n    <div id="hiddenBox"></div>\n    </div>\n  </section>\n\n  <section class="view" id="v-cust" hidden>\n    <div class="nosales" id="gateCust" hidden></div>\n    <div id="custBody">\n    <div class="search">\n      <input id="cq" type="text" autocomplete="off" placeholder="Type a customer name" aria-label="Customer name">\n      <button type="button" class="clr" id="clr" aria-label="Clear customer" hidden>&#10005;</button>\n      <div class="sugg" id="sugg" hidden></div>\n    </div>\n    <p class="try" id="tryLabel">Biggest accounts this year:</p>\n    <div class="chips" id="quick"></div>\n    <div id="brief"></div>\n    </div>\n  </section>\n\n  <p class="foot">How impact is worked out: each recap topic is matched to the products in your sales analysis. Customers are ranked by dollars bought this year (2026 YTD) in those products. &ldquo;vs last year&rdquo; compares the same period of 2025. Waste services, fees and containers are left out.</p>' + '</div>';
const RECAP = MARKET_RECAP.topics;
let CUST = [];            // [{c, l:[[product, lbYTD, lbLY, $YTD, $LY, lastDate, [[pkg, lb, units]]]]}], from this rep's own sales analysis
const $ = id => root.getElementById(id);

/* ---- trends ---- */
const TR = {
  'up':{e:'⬆️',l:'Up',c:'var(--t-up)',w:1},
  'stable-up':{e:'↗️',l:'Stable to Up',c:'var(--t-stable-up)',w:.85},
  'stable':{e:'➡️',l:'Stable',c:'var(--t-stable)',w:.3},
  'stable-down':{e:'↘️',l:'Stable to Down',c:'var(--t-stable-down)',w:.6},
  'down':{e:'⬇️',l:'Down',c:'var(--t-down)',w:.9},
  'volatile':{e:'⚡',l:'Volatile',c:'var(--t-volatile)',w:1}
};

/* ---- recap topic -> products in the sales analysis (rules ship with the recap data) ---- */
const FEED = {}, RULES = {};
RECAP.forEach(t => { if (t.feed && t.feed.length) FEED[t.name] = t.feed; else if (t.re) { try { RULES[t.name] = new RegExp(t.re, 'i'); } catch (_) {} } });
const TOPICS = RECAP.map(r => Object.assign({}, r, {feed: !!FEED[r.name]}));
const byName = Object.fromEntries(TOPICS.map(t => [t.name, t]));
function topicMatch(t, product){
  if (t.feed) return FEED[t.name].some(n => RULES[n] && RULES[n].test(product));
  return !!(RULES[t.name] && RULES[t.name].test(product));
}

/* ---- numbers ---- */
const money = n => '$' + Math.round(n).toLocaleString('en-US');
const lbs = n => n >= 100000 ? Math.round(n/1000).toLocaleString('en-US') + 'k lb' : n >= 10000 ? (n/1000).toFixed(1) + 'k lb' : Math.round(n).toLocaleString('en-US') + ' lb';
const dstr = iso => { const [y,m,d] = iso.split('-'); return +m + '/' + +d + '/' + y; };
function delta(yd, ld){
  if (ld > 0) { const p = Math.round((yd - ld) / ld * 100); return {cls: p > 0 ? 'pos' : p < 0 ? 'neg' : '', txt: (p > 0 ? '+' : '') + p + '%'}; }
  return yd > 0 ? {cls:'new', txt:'new'} : {cls:'', txt:'0%'};
}
const dEl = (yd, ld) => { const d = delta(yd, ld); return '<span class="delta ' + d.cls + '">' + d.txt + '</span>'; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const trim = s => String(s).replace(/[.\s]+$/, '');

/* ---- per customer x topic ---- */
function custTopic(c, t){
  const ls = c.l.filter(l => topicMatch(t, l[0]) && (l[3] > 0 || l[4] > 0));
  if (!ls.length) return null;
  const sum = i => ls.reduce((a, l) => a + l[i], 0);
  const top = ls.slice().sort((a, b) => b[3] - a[3])[0];
  const last = ls.map(l => l[5]).sort().pop();
  return {lines: ls, lb: sum(1), lbLY: sum(2), usd: sum(3), usdLY: sum(4), top, last};
}
function impacted(t, n){
  const rows = [];
  CUST.forEach(c => { const m = custTopic(c, t); if (m && m.usd > 0) rows.push({c, m}); });
  rows.sort((a, b) => b.m.usd - a.m.usd);
  return {all: rows, shown: rows.slice(0, n)};
}
const custTotal = c => c.l.reduce((a, l) => a + l[3], 0);
const custTotalLY = c => c.l.reduce((a, l) => a + l[4], 0);

/* ================= TOPICS VIEW ================= */
let topN = 5, trendFilter = 'all';
const openTopics = new Set(['Acetone']);
const detailOpen = new Set();
function drawChips(){
  const counts = {}; TOPICS.forEach(t => counts[t.trend] = (counts[t.trend] || 0) + 1);
  const items = [['all', 'All ' + TOPICS.length]].concat(Object.keys(TR).filter(k => counts[k]).map(k => [k, TR[k].e + ' ' + TR[k].l + ' ' + counts[k]]));
  $('trendChips').innerHTML = items.map(([k, label]) => '<button type="button" class="chip" data-t="' + k + '" aria-pressed="' + (trendFilter === k) + '">' + label + '</button>').join('');
}
function drawTopics(){
  const list = TOPICS.filter(t => trendFilter === 'all' || t.trend === trendFilter);
  $('tcount').textContent = list.length + ' of ' + TOPICS.length + ' topics';
  let html = '', cat = '';
  list.forEach(t => {
    if (t.cat !== cat) { cat = t.cat; html += '<div class="cat-label">' + esc(cat) + '</div>'; }
    const tr = TR[t.trend], open = openTopics.has(t.name), imp = impacted(t, topN);
    const reach = imp.all.length ? imp.all.length + ' customers bought this year · ' + money(imp.all.reduce((a, r) => a + r.m.usd, 0)) : 'No customer bought these products this year';
    html += '<div class="card' + (open ? ' open' : '') + '" data-name="' + esc(t.name) + '">' +
      '<button class="card-h" type="button" aria-expanded="' + open + '">' +
        '<span class="arrow" aria-hidden="true">' + tr.e + '</span>' +
        '<span class="card-m"><span class="nm">' + esc(t.name) + '<span class="badge" style="color:' + tr.c + '">' + tr.l + '</span></span>' +
        '<div class="ln">' + esc(t.line) + '</div>' +
        '<div class="tags">' + t.tags.map(x => '<span class="tag">' + esc(x) + '</span>').join('') + '</div>' +
        '<div class="reach">' + reach + '</div></span>' +
        '<span class="chev" aria-hidden="true">▼</span></button>';
    if (open) {
      const showD = detailOpen.has(t.name);
      html += '<div class="card-b"><div class="bl-h">Bottom line</div><div class="bl">' + esc(t.bottom) + '</div>' +
        '<div class="sec-h">Most impacted customers <span class="mono" style="font-weight:500;color:var(--text-faint);letter-spacing:0;text-transform:none">by $ bought 2026 YTD</span></div>';
      if (imp.shown.length) {
        html += '<div class="crows">' + imp.shown.map((r, i) =>
          '<button class="crow" type="button" data-c="' + esc(r.c.c) + '"><span class="rk">' + (i + 1) + '</span><span class="cn">' + esc(r.c.c) + '</span>' +
          '<span class="cs"><b>' + money(r.m.usd) + '</b> · ' + lbs(r.m.lb) + ' · ' + dEl(r.m.usd, r.m.usdLY) + '</span>' +
          '<span class="cprods">' + esc(r.m.lines.map(l => l[0]).slice(0, 3).join(', ')) + ' · last bought ' + dstr(r.m.last) + '</span></button>').join('') + '</div>';
      } else html += '<div class="empty">Nobody bought these products this year. This topic is open to sell direct.</div>';
      const names = []; CUST.forEach(c => c.l.forEach(l => { if (topicMatch(t, l[0]) && !names.includes(l[0]) && (l[3] > 0 || l[4] > 0)) names.push(l[0]); }));
      html += '<div class="sec-h">Full detail <button class="mini" type="button" data-d="' + esc(t.name) + '">' + (showD ? 'Hide' : 'Show') + '</button></div>' +
        (showD ? '<div class="detail">' + esc(t.detail) + '</div>' : '') +
        '<div class="matched">Matched to: ' + (names.length ? esc(names.slice(0, 12).join(' · ')) + (names.length > 12 ? ' · +' + (names.length - 12) + ' more' : '') : 'no products in your sales analysis') + '</div></div>';
    }
    html += '</div>';
  });
  $('topics').innerHTML = html || '<div class="empty">No topics match this filter.</div>';
}
$('trendChips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; trendFilter = b.dataset.t; drawChips(); drawTopics(); });
$('topics').addEventListener('click', e => {
  const cr = e.target.closest('.crow'); if (cr) { showView('cust'); pick(cr.dataset.c); window.scrollTo(0, 0); return; }
  const dBtn = e.target.closest('[data-d]'); if (dBtn) { const n = dBtn.dataset.d; detailOpen.has(n) ? detailOpen.delete(n) : detailOpen.add(n); drawTopics(); return; }
  const h = e.target.closest('.card-h'); if (!h) return;
  const n = h.parentElement.dataset.name; openTopics.has(n) ? openTopics.delete(n) : openTopics.add(n); drawTopics();
});
function setN(n){ topN = n; $('n3').setAttribute('aria-pressed', n === 3); $('n5').setAttribute('aria-pressed', n === 5); drawTopics(); }
$('n3').onclick = () => setN(3); $('n5').onclick = () => setN(5);
$('expAll').onclick = () => {
  const list = TOPICS.filter(t => trendFilter === 'all' || t.trend === trendFilter);
  const all = list.every(t => openTopics.has(t.name));
  list.forEach(t => all ? openTopics.delete(t.name) : openTopics.add(t.name));
  $('expAll').textContent = all ? 'Expand all' : 'Collapse all'; drawTopics();
};

/* ================= CUSTOMER VIEW ================= */
function drawQuick(){
  const big = CUST.slice().sort((a, b) => custTotal(b) - custTotal(a)).slice(0, 8);
  $('quick').innerHTML = big.map(c => '<button type="button" class="chip" data-c="' + esc(c.c) + '">' + esc(c.c) + '</button>').join('');
}
$('quick').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) pick(b.dataset.c); });

const sugg = $('sugg'), cq = $('cq');
const syncClr = () => { $('clr').hidden = !cq.value; };
function clearCustomer(){ current = null; cq.value = ''; sugg.hidden = true; $('brief').innerHTML = ''; $('tryLabel').hidden = false; $('quick').hidden = false; syncClr(); cq.focus(); }
$('clr').addEventListener('click', clearCustomer);
cq.addEventListener('input', () => {
  const q = cq.value.trim().toLowerCase();
  syncClr();
  if (!q) { sugg.hidden = true; if (current) clearCustomer(); return; }
  const hits = CUST.filter(c => c.c.toLowerCase().includes(q)).sort((a, b) => custTotal(b) - custTotal(a)).slice(0, 8);
  sugg.innerHTML = hits.length ? hits.map(c => '<button type="button" data-c="' + esc(c.c) + '"><span>' + esc(c.c) + '</span><span class="k">' + money(custTotal(c)) + ' YTD</span></button>').join('')
    : '<div class="empty" style="padding:12px 14px">No customer matches &ldquo;' + esc(cq.value.trim()) + '&rdquo;.</div>';
  sugg.hidden = false;
});
cq.addEventListener('keydown', e => { if (e.key === 'Enter') { const b = sugg.querySelector('button'); if (b) pick(b.dataset.c); } });
sugg.addEventListener('click', e => { const b = e.target.closest('button'); if (b) pick(b.dataset.c); });
root.addEventListener('click', e => { if (!e.target.closest('.search')) sugg.hidden = true; });

/* suggested opening line, by trend. Uses only the recap line and the customer's own numbers. */
function sayLine(t, prod){
  const L = trim(t.line), N = t.name;
  switch (t.trend) {
    case 'up': return N + ': ' + L + '. Want to lock in your next ' + prod + ' order ahead of it?';
    case 'stable-up': return N + ': ' + L + '. Want to talk through timing on your next ' + prod + ' order?';
    case 'down': case 'stable-down': return N + ': ' + L + '. Want me to take a fresh look at pricing on your ' + prod + '?';
    case 'volatile': return N + ': ' + L + '. Would a scheduled delivery of ' + prod + ' help you avoid surprises?';
    default: return N + ': ' + L + '. Anything coming up I can quote?';
  }
}
function whyLine(m){
  const d = delta(m.usd, m.usdLY);
  const vs = d.cls === 'new' ? 'new this year' : (d.txt + ' vs last year');
  return 'They bought ' + lbs(m.lb) + ' (' + money(m.usd) + ') of ' + m.lines.slice().sort((a, b) => b[3] - a[3]).slice(0, 2).map(l => l[0]).join(' and ') + ' this year, ' + vs + '. Last bought ' + dstr(m.last) + '.';
}
function lapsed(c){
  const cutoff = '2026-05-08';
  return c.l.filter(l => l[3] === 0 && l[4] >= 250 && l[5] < cutoff).sort((a, b) => b[4] - a[4]).slice(0, 3);
}
/* ---- how they buy: drums, totes (incl. FT full-truck, treated as totes), bulk, pails ---- */
let REPORT_DATE = '2026-11-08';
const DRUM_MIN = 25, INACTIVE_DAYS = 365, MIN_LB_INACTIVE = 25, MIN_LB_STOP = 100, MIN_LB_LESS = 350;
const PK = {drum:'Drums', tote:'Totes', bulk:'Bulk', pail:'Pails', bag:'Bags', small:'Small packs', other:'Other'};
const pkChip = (e, flag) => '<span class="pk' + (flag ? ' flagged' : '') + '">' + PK[e[0]] + (e[2] > 0 && e[0] !== 'bulk' ? ' ' + Math.max(1, e[2]).toLocaleString('en-US') : '') + '</span>';
const pkTags = l => (l[6] || []).map(e => pkChip(e, false)).join('');
function mixLine(c){
  const g = {drum:0, tote:0, bulk:0, small:0}, key = t => (t === 'pail' || t === 'bag' || t === 'small' || t === 'other') ? 'small' : t;
  c.l.forEach(l => { if (l[3] > 0) (l[6] || []).forEach(e => { g[key(e[0])] += e[1]; }); });
  const tot = g.drum + g.tote + g.bulk + g.small; if (!tot) return '';
  const lab = {drum:'drums', tote:'totes', bulk:'bulk', small:'small packs'};
  const parts = Object.keys(g).map(k => [k, Math.round(g[k] / tot * 100)]).filter(x => x[1] >= 10).sort((a, b) => b[1] - a[1]);
  return parts[0][1] >= 70 ? 'Mostly ' + lab[parts[0][0]] + ' (' + parts[0][1] + '% of pounds)' : parts.map(x => lab[x[0]] + ' ' + x[1] + '%').join(' \u00B7 ');
}
/* drum volume worth a tote or bulk conversation: 25+ drums of one product this year, not already mostly tote/bulk */
function drumFlags(c, cap){
  const out = [];
  c.l.forEach(l => {
    if (l[3] <= 0) return;
    const pk = l[6] || [], dr = pk.find(e => e[0] === 'drum'); if (!dr || dr[2] < DRUM_MIN) return;
    const big = pk.filter(e => e[0] === 'tote' || e[0] === 'bulk').reduce((a, e) => a + e[1], 0);
    if (big >= dr[1]) return;
    out.push({name: l[0], drums: dr[2], lb: dr[1], also: big > 0});
  });
  return out.sort((a, b) => b.drums - a.drums).slice(0, cap || 3);
}
function flagText(f){ return f.name + ': about ' + f.drums.toLocaleString('en-US') + ' drums this year (' + lbs(f.lb) + ')' + (f.also ? ', and they already take some in totes or bulk' : '') + '. Ask whether totes or bulk would work for them.'; }
function build(c){
  const rows = [];
  TOPICS.filter(t => !t.feed).forEach(t => { const m = custTopic(c, t); if (m && m.usd > 0) rows.push({t, m, score: m.usd * TR[t.trend].w}); });
  rows.sort((a, b) => b.score - a.score);
  return {rows, talk: rows.slice(0, 3), radar: rows.slice(3)};
}
let current = null;
function pick(name){
  const c = CUST.find(x => x.c === name); if (!c) return;
  current = c; cq.value = c.c; syncClr(); sugg.hidden = true; $('tryLabel').hidden = true; $('quick').hidden = true; drawBrief(c);
}
function plain(c, B){
  const tot = custTotal(c), ly = custTotalLY(c);
  let s = c.c + ' — pre-meeting brief\n' + money(tot) + ' bought 2026 YTD (' + delta(tot, ly).txt.replace('new', 'new') + ' vs last year)\n\nTalk about:\n';
  B.talk.forEach((r, i) => { s += (i + 1) + '. ' + r.t.name + ' (' + TR[r.t.trend].l + '): ' + trim(r.t.line) + '. ' + whyLine(r.m) + '\n   Say: ' + sayLine(r.t, r.m.top[0]) + '\n'; });
  if (!B.talk.length) s += 'No topics in this month\u2019s recap apply. Buys: ' + c.l.slice().sort((a, b) => b[3] - a[3]).slice(0, 6).map(l => l[0] + ' ' + money(l[3])).join('; ') + '\n';
  const mx = mixLine(c); if (mx) s += '\nHow they buy: ' + mx + '\n';
  const fl = drumFlags(c); if (fl.length) s += 'Tote/bulk idea: ' + fl.map(flagText).join(' ') + '\n';
  const lp = lapsed(c); if (lp.length) s += '\nCheck on: ' + lp.map(l => l[0] + ' (' + money(l[4]) + ' last year, nothing since ' + dstr(l[5]) + ')').join('; ') + '\n';
  return s;
}
function drawBrief(c){
  const B = build(c), tot = custTotal(c), ly = custTotalLY(c), last = c.l.map(l => l[5]).sort().pop();
  const topProds = c.l.slice().sort((a, b) => b[3] - a[3]).filter(l => l[3] > 0).slice(0, 4);
  let h = '<div class="brief"><div class="b-head"><div class="b-top"><h3>' + esc(c.c) + '</h3><button class="mini" id="clearCust" type="button">Clear \u2715</button></div><div class="b-sub">Last order ' + dstr(last) + '</div>' +
    '<div class="stats"><div class="stat"><div class="k">Bought 2026</div><div class="v">' + money(tot) + '</div></div>' +
    '<div class="stat"><div class="k">vs last year</div><div class="v">' + dEl(tot, ly) + ' <small>' + (ly ? money(ly) + ' LY' : 'no 2025 sales') + '</small></div></div>' +
    '<div class="stat"><div class="k">Recap topics</div><div class="v">' + B.rows.length + '</div></div></div>' +
    '<div class="top-prods">' + (mixLine(c) ? '<b>How they buy:</b> ' + esc(mixLine(c)) + '<br>' : '') + (topProds.length ? '<b>Buys most:</b> ' + esc(topProds.map(l => l[0] + ' ' + money(l[3])).join(' · ')) : '<b>Nothing bought this year.</b> Last year: ' + esc(c.l.slice().sort((a, b) => b[4] - a[4]).slice(0, 3).map(l => l[0] + ' ' + money(l[4])).join(' · '))) + '</div></div>';
  h += '<div class="talk-h">Talk about <button class="mini" id="copyBrief" type="button">Copy brief</button></div>';
  if (!B.talk.length) h += '<div class="nt">No topics in this month&rsquo;s recap apply to ' + esc(c.c) + '. Everything they buy is listed below.</div>';
  B.talk.forEach((r, i) => {
    const tr = TR[r.t.trend];
    h += '<div class="tp" style="--tc:' + tr.c + '"><div class="tp-top"><span class="tp-n">' + (i + 1) + '</span><span class="tp-t">' + tr.e + ' ' + esc(r.t.name) + '</span><span class="badge" style="color:' + tr.c + '">' + tr.l + '</span></div>' +
      '<div class="tp-line">' + esc(r.t.line) + '</div><div class="tp-why">' + esc(whyLine(r.m)) + '</div>' +
      '<div class="tp-pk">' + r.m.lines.slice().sort((a, b) => b[3] - a[3]).slice(0, 2).map(l => '<span class="pk-n">' + esc(l[0]) + '</span>' + pkTags(l)).join('<br>') + '</div>' +
      '<div class="tp-say"><b>You could say</b>&ldquo;' + esc(sayLine(r.t, r.m.top[0])) + '&rdquo;</div></div>';
  });
  const fl = drumFlags(c);
  if (fl.length) h += '<div class="talk-h">Move to totes or bulk?</div><div class="flagcard">' + fl.map(f => '<div><b>' + esc(f.name) + '</b>: about ' + f.drums.toLocaleString('en-US') + ' drums this year (' + lbs(f.lb) + ')' + (f.also ? ', and they already take some in totes or bulk' : '') + '. Ask whether totes or bulk would work for them.</div>').join('') + '</div>';
  if (B.radar.length) {
    h += '<div class="talk-h">Also on the radar</div><div class="radar">' + B.radar.map(r => '<div class="rd"><span aria-hidden="true">' + TR[r.t.trend].e + '</span><span class="nm2">' + esc(r.t.name) + '</span><span class="amt">' + money(r.m.usd) + ' · ' + dEl(r.m.usd, r.m.usdLY) + '</span></div>').join('') + '</div>';
  }
  const lp = lapsed(c);
  if (lp.length) h += '<div class="talk-h">Worth asking about</div><div class="watch">' + lp.map(l => '<div><b>' + esc(l[0]) + '</b>: ' + money(l[4]) + ' last year, nothing since ' + dstr(l[5]) + '. Ask what changed.</div>').join('') + '</div>';
  const used = new Set(); B.rows.forEach(r => r.m.lines.forEach(l => used.add(l[0])));
  const rest = c.l.filter(l => !used.has(l[0])).sort((a, b) => b[3] - a[3] || b[4] - a[4]);
  if (rest.length) {
    h += '<div class="talk-h">' + (B.rows.length ? 'Everything else they buy' : 'What they buy') + ' <span class="mono" style="font-weight:500;letter-spacing:0;text-transform:none">' + rest.length + ' product' + (rest.length === 1 ? '' : 's') + '</span></div><div class="radar">' +
      rest.map(l => '<div class="rd"><span class="nm2">' + esc(l[0]) + '<small>last bought ' + dstr(l[5]) + '</small><span class="pks">' + pkTags(l) + '</span></span><span class="amt">' + (l[3] > 0 ? money(l[3]) + ' \u00B7 ' + lbs(l[1]) + ' \u00B7 ' + dEl(l[3], l[4]) : 'none this year \u00B7 ' + money(l[4]) + ' last year') + '</span></div>').join('') + '</div>';
  }
  h += '<div id="copyOut"></div></div>';
  $('brief').innerHTML = h;
  $('clearCust').onclick = clearCustomer;
  $('copyBrief').onclick = async () => {
    const txt = plain(c, B), out = $('copyOut');
    try { await navigator.clipboard.writeText(txt); $('copyBrief').textContent = 'Copied'; setTimeout(() => { const b = $('copyBrief'); if (b) b.textContent = 'Copy brief'; }, 2000); }
    catch (_) { out.innerHTML = '<textarea class="copybox" id="cbx" readonly aria-label="Brief text"></textarea>'; const t = $('cbx'); t.value = txt; t.focus(); t.select(); }
  };
}

/* ================= VIEW SWITCH ================= */
/* ================= FLAGGED ACCOUNTS ================= */
const daysSince = iso => Math.round((Date.parse(REPORT_DATE) - Date.parse(iso)) / 86400000);
const topicOf = product => TOPICS.find(t => !t.feed && topicMatch(t, product));
const tpTag = product => { const t = topicOf(product); return t ? '<span class="tpc">' + TR[t.trend].e + ' ' + esc(t.name) + '</span>' : ''; };
const custLb = c => c.l.reduce((a, l) => a + l[1], 0), custLbLY = c => c.l.reduce((a, l) => a + l[2], 0);
const acctTag = c => '<br><span class="acct">Account overall: ' + dEl(custLb(c), custLbLY(c)) + ' in pounds vs last year (' + lbs(custLb(c)) + ' this year)</span>';

/* hidden flags and accounts: kept on this device in the mockup; the real app would keep them in its database */
let HIDE = {flags: [], accounts: []}, DB = null;
const saveHide = () => { if (DB) DB.doc('market/hides').set({flags: HIDE.flags, accounts: HIDE.accounts}).catch(() => {}); };
const isHidden = r => HIDE.accounts.includes(r.c.c) || HIDE.flags.some(f => f.k === r.key);

const KIND = {inactive: 'Inactive accounts', stopped: 'Stopped a product', less: 'Buying less', bulk: 'Bulk opportunity'};
const SHORT = {inactive: 'Inactive', stopped: 'Stopped', less: 'Buying less', bulk: 'Bulk'};

function bulkRows(){
  const rows = [];
  CUST.forEach(c => drumFlags(c, 99).forEach(f => {
    const l = c.l.find(x => x[0] === f.name);
    rows.push({kind: 'bulk', c, key: 'bulk|' + c.c + '|' + f.name, label: c.c + ': ' + f.name, sort: f.drums,
      tag: SHORT.bulk, right: '<b>' + f.drums.toLocaleString('en-US') + ' drums</b> · ' + lbs(f.lb),
      sub: '<b>' + esc(f.name) + '</b>' + (f.also ? ' (already takes some in totes or bulk)' : '') + ' · last bought ' + dstr(l[5]) + tpTag(f.name)});
  }));
  return rows.sort((a, b) => b.sort - a.sort);
}
function missRows(){
  const rows = [];
  CUST.forEach(c => {
    const last = c.l.map(l => l[5]).sort().pop(), age = daysSince(last), ly = custLbLY(c);
    if (age >= INACTIVE_DAYS) {
      if (ly >= MIN_LB_INACTIVE) rows.push({kind: 'inactive', c, key: 'inactive|' + c.c, label: c.c + ': inactive', sort: ly, tag: SHORT.inactive, right: '<b>' + lbs(ly) + '</b> LY',
        sub: 'Last order ' + dstr(last) + ' (' + Math.round(age / 30.4) + ' months ago) · bought ' + esc(c.l.slice().sort((a, b) => b[2] - a[2]).slice(0, 2).map(l => l[0]).join(', '))});
      return;
    }
    const stopped = c.l.filter(l => l[1] === 0 && l[2] >= MIN_LB_STOP && daysSince(l[5]) >= 180).sort((a, b) => b[2] - a[2]);
    if (stopped.length) {
      const top = stopped[0], tot = stopped.reduce((a, l) => a + l[2], 0);
      rows.push({kind: 'stopped', c, key: 'stopped|' + c.c, label: c.c + ': stopped ' + top[0] + (stopped.length > 1 ? ' +' + (stopped.length - 1) : ''), sort: tot, tag: SHORT.stopped, right: '<b>' + lbs(tot) + '</b> LY → 0',
        sub: '<b>' + esc(top[0]) + '</b>' + (stopped.length > 1 ? ' and ' + (stopped.length - 1) + ' more' : '') + ' last bought ' + dstr(top[5]) + tpTag(top[0]) + acctTag(c)});
    }
    c.l.forEach(l => {
      if (l[1] > 0 && l[2] >= MIN_LB_LESS && l[1] <= l[2] * 0.5) rows.push({kind: 'less', c, key: 'less|' + c.c + '|' + l[0], label: c.c + ': ' + l[0] + ' down', sort: l[2] - l[1], tag: SHORT.less, right: dEl(l[1], l[2]),
        sub: '<b>' + esc(l[0]) + '</b>: ' + lbs(l[1]) + ' vs ' + lbs(l[2]) + ' last year' + tpTag(l[0]) + acctTag(c)});
    });
  });
  return rows.sort((a, b) => b.sort - a.sort);
}
let flagTab = 'bulk', missKind = 'all', flagAll = false, ignOpen = null, showHidden = false, ROWS = {};
function frow(r, i){
  ROWS[r.key] = r;
  const act = ignOpen === r.key
    ? '<span class="fl-q">Hide:</span><button type="button" class="mini" data-hide="flag" data-k="' + esc(r.key) + '">just this flag</button><button type="button" class="mini" data-hide="acct" data-c="' + esc(r.c.c) + '">the whole account</button><button type="button" class="mini" data-hide="cancel">Cancel</button>'
    : '<button type="button" class="mini" data-ign="' + esc(r.key) + '">Hide…</button>';
  return '<div class="frow"><button class="crow" type="button" data-c="' + esc(r.c.c) + '"><span class="rk">' + (i + 1) + '</span><span class="cn">' + esc(r.c.c) + '</span><span class="cs">' + r.right + '</span><span class="fl-sub"><span class="kb">' + r.tag + '</span>' + r.sub + '</span></button><div class="fl-act">' + act + '</div></div>';
}
function drawFlags(){
  ROWS = {};
  const bulk = bulkRows().filter(r => !isHidden(r)), miss = missRows().filter(r => !isHidden(r));
  $('f-bulk').textContent = 'Bulk opportunities ' + bulk.length;
  $('f-miss').textContent = 'Missed sales ' + miss.length;
  $('f-bulk').setAttribute('aria-selected', flagTab === 'bulk'); $('f-miss').setAttribute('aria-selected', flagTab === 'miss');
  $('missChips').hidden = flagTab !== 'miss';
  let rows;
  if (flagTab === 'bulk') {
    $('fnote').textContent = 'Customers buying ' + DRUM_MIN + '+ drums of one product this year who are not already taking most of it in totes or bulk. Biggest first.';
    rows = bulk;
  } else {
    const counts = {all: miss.length}; miss.forEach(r => { counts[r.kind] = (counts[r.kind] || 0) + 1; });
    $('missChips').innerHTML = [['all', 'All ' + miss.length]].concat(['inactive', 'stopped', 'less'].map(k => [k, KIND[k] + ' ' + (counts[k] || 0)])).map(([k, label]) => '<button type="button" class="chip" data-k="' + k + '" aria-pressed="' + (missKind === k) + '">' + label + '</button>').join('');
    $('fnote').textContent = 'All flags go by pounds, not dollars. Inactive: no order in 12+ months (as of 11/8) after buying ' + MIN_LB_INACTIVE + '+ lb last year. Stopped a product: ' + MIN_LB_STOP + '+ lb last year, nothing this year (one row per customer). Buying less: pounds down 50% or more on a product that was ' + MIN_LB_LESS + '+ lb. Seasonal buyers can show up. Use Hide to remove a flag or a closed account.';
    rows = miss.filter(r => missKind === 'all' || r.kind === missKind);
  }
  const shown = flagAll ? rows : rows.slice(0, 15);
  let html = shown.length ? '<div class="card" style="padding:4px 14px">' + shown.map(frow).join('') + '</div>' : '<div class="empty">Nothing flagged here.</div>';
  if (rows.length > 15) html += '<p style="text-align:center;margin:10px 0"><button class="mini" id="flagMore" type="button">' + (flagAll ? 'Show top 15' : 'Show all ' + rows.length) + '</button></p>';
  $('flagList').innerHTML = html;
  const nh = HIDE.flags.length + HIDE.accounts.length;
  let hb = '';
  if (nh) {
    hb = '<div class="hidbox"><button class="mini" id="hidToggle" type="button">' + (showHidden ? 'Hide the hidden list' : 'Hidden: ' + HIDE.accounts.length + ' account' + (HIDE.accounts.length === 1 ? '' : 's') + ', ' + HIDE.flags.length + ' flag' + (HIDE.flags.length === 1 ? '' : 's')) + '</button>';
    if (showHidden) hb += '<div class="card" style="padding:4px 14px;margin-top:8px">' +
      HIDE.accounts.map((n, i) => '<div class="hrow"><span><b>' + esc(n) + '</b> · whole account</span><button class="mini" type="button" data-restore="a" data-i="' + i + '">Restore</button></div>').join('') +
      HIDE.flags.map((f, i) => '<div class="hrow"><span>' + esc(f.label) + '</span><button class="mini" type="button" data-restore="f" data-i="' + i + '">Restore</button></div>').join('') + '</div>';
    hb += '</div>';
  }
  $('hiddenBox').innerHTML = hb;
}
$('f-bulk').onclick = () => { flagTab = 'bulk'; flagAll = false; ignOpen = null; drawFlags(); };
$('f-miss').onclick = () => { flagTab = 'miss'; flagAll = false; ignOpen = null; drawFlags(); };
$('missChips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; missKind = b.dataset.k; flagAll = false; ignOpen = null; drawFlags(); });
$('flagList').addEventListener('click', e => {
  if (e.target.closest('#flagMore')) { flagAll = !flagAll; drawFlags(); return; }
  const ig = e.target.closest('[data-ign]'); if (ig) { ignOpen = ig.dataset.ign; drawFlags(); return; }
  const hd = e.target.closest('[data-hide]');
  if (hd) {
    const how = hd.dataset.hide;
    if (how === 'flag') { const r = ROWS[hd.dataset.k]; if (r) { HIDE.flags.push({k: r.key, label: r.label}); saveHide(); } }
    if (how === 'acct') { if (!HIDE.accounts.includes(hd.dataset.c)) { HIDE.accounts.push(hd.dataset.c); saveHide(); } }
    ignOpen = null; drawFlags(); return;
  }
  const cr = e.target.closest('.crow'); if (cr) { showView('cust'); pick(cr.dataset.c); window.scrollTo(0, 0); }
});
$('hiddenBox').addEventListener('click', e => {
  if (e.target.closest('#hidToggle')) { showHidden = !showHidden; drawFlags(); return; }
  const rs = e.target.closest('[data-restore]'); if (!rs) return;
  const i = +rs.dataset.i; if (rs.dataset.restore === 'a') HIDE.accounts.splice(i, 1); else HIDE.flags.splice(i, 1);
  saveHide(); if (!HIDE.flags.length && !HIDE.accounts.length) showHidden = false; drawFlags();
});

/* ================= VIEW SWITCH ================= */
const VIEWS = {topics: ['v-topics', 't-topics', '#topics'], cust: ['v-cust', 't-cust', '#customer'], flag: ['v-flag', 't-flag', '#flagged']};
function showView(v){
  Object.keys(VIEWS).forEach(k => { $(VIEWS[k][0]).hidden = k !== v; $(VIEWS[k][1]).setAttribute('aria-selected', k === v); });
  if (v === 'flag') drawFlags();
}
$('t-topics').onclick = () => showView('topics'); $('t-cust').onclick = () => showView('cust'); $('t-flag').onclick = () => showView('flag');


/* ================= SALES ANALYSIS (each rep uploads their own, every month) ================= */
let SALES = null, HAS = false, busyMsg = '', errMsg = '', rmAsk = false;
function visibleView(){ return ['topics', 'cust', 'flag'].find(k => !$(VIEWS[k][0]).hidden); }
function renderSalesBar(){
  const box = $('salesBar');
  if (busyMsg) { box.innerHTML = '<div class="busy"><span class="spin"></span>' + esc(busyMsg) + '</div>'; return; }
  let h = errMsg ? '<div class="err">' + esc(errMsg) + '</div>' : '';
  if (!HAS) {
    h += '<div class="upl"><b>Upload your sales analysis to see your customers</b><p>Use the monthly &ldquo;S/A Customer Product Sales By Sales Agent&rdquo; report as a PDF, in pounds. It is read on this device and saved to your account only. The recap below works without it.</p><button class="btn" id="pickFile" type="button">Choose the PDF</button></div>';
  } else {
    const ok = SALES && SALES.verified;
    h += '<div class="salesbar"><span class="sb-t">Sales analysis as of <b>' + esc(dstr(SALES.asOf)) + '</b>' + (SALES.agent ? ' for ' + esc(SALES.agent) : '') + ' \u00B7 ' + CUST.length + ' customers with product sales \u00B7 ' +
      (ok ? '<span class="ok">totals match the report</span>' : '<span class="warn">totals did not match the report, check that it is the full report</span>') + '</span>' +
      (rmAsk ? '<span class="cf">Remove your sales data from the app? <button class="mini" id="rmYes" type="button">Remove</button><button class="mini" id="rmNo" type="button">Keep</button></span>'
             : '<button class="mini" id="pickFile" type="button">Replace</button><button class="mini" id="rmAsk" type="button">Remove</button>') + '</div>';
  }
  box.innerHTML = h;
}
function renderGates(){
  const msg = '<b>Upload your sales analysis first.</b><br>This view is built from the customers in your own monthly report.<br><button class="btn" data-pick type="button">Choose the PDF</button>';
  $('gateCust').innerHTML = msg; $('gateFlag').innerHTML = msg;
  $('gateCust').hidden = HAS; $('custBody').hidden = !HAS;
  $('gateFlag').hidden = HAS; $('flagBody').hidden = !HAS;
}
function refreshAll(){
  renderSalesBar(); renderGates(); drawChips(); drawTopics(); drawQuick();
  if (current && !CUST.find(c => c.c === current.c)) clearCustomer(); else if (current) { current = CUST.find(c => c.c === current.c); drawBrief(current); }
  if (visibleView() === 'flag') drawFlags();
}
function setSales(doc){
  SALES = doc; CUST = doc && Array.isArray(doc.customers) ? doc.customers : []; HAS = CUST.length > 0;
  if (HAS && doc.asOf) REPORT_DATE = doc.asOf;
  refreshAll();
}
async function loadSalesFile(f){
  errMsg = ''; busyMsg = 'Reading the report. This takes a few seconds.'; renderSalesBar();
  try {
    if (typeof plPdfLib !== 'function') throw new Error('The PDF reader is not available here.');
    const lib = await plPdfLib();
    const text = await mkReadPdfText(lib, f);
    const parsed = mkParseSales(text);
    if (parsed.um && parsed.um !== 'LB') throw new Error('This report is in ' + parsed.um + '. Run it in pounds (Report UM: LB) and upload again.');
    if (!parsed.customers.length || !parsed.lines || !parsed.asOf) throw new Error('This does not look like the S/A Customer Product Sales By Sales Agent report. Check the file and try again.');
    const grandOk = parsed.grand ? Math.abs(parsed.grand.dytd - parsed.sumYtd) < 2 && Math.abs(parsed.grand.dlytd - parsed.sumLytd) < 2 : false;
    const customers = mkCompact(parsed);
    const doc = {asOf: parsed.asOf, agent: parsed.agent, uploaded: new Date().toISOString(), filename: f.name, customerCount: parsed.customers.length, lineCount: parsed.lines,
      verified: grandOk && parsed.mismatches === 0, customers};
    busyMsg = 'Saving\u2026'; renderSalesBar();
    if (DB) await DB.doc('market/sales').set(doc);
    setSales(doc);
  } catch (e) { errMsg = (e && e.message) || 'Could not read that file.'; }
  busyMsg = ''; renderSalesBar();
}
$('salesFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) loadSalesFile(f); });
root.addEventListener('click', async e => {
  if (e.target.closest('#pickFile') || e.target.closest('[data-pick]')) { $('salesFile').click(); return; }
  if (e.target.closest('#rmAsk')) { rmAsk = true; renderSalesBar(); return; }
  if (e.target.closest('#rmNo')) { rmAsk = false; renderSalesBar(); return; }
  if (e.target.closest('#rmYes')) {
    rmAsk = false;
    try { if (DB) await DB.doc('market/sales').delete(); } catch (_) {}
    setSales(null);
  }
});
/* phones: keep the search box above the keyboard (the app's own helper cannot see inside this container) */
root.addEventListener('focusin', e => { if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'text') setTimeout(() => { try { e.target.scrollIntoView({block: 'center', behavior: 'smooth'}); } catch (_) {} }, 350); });

/* ================= START ================= */
(function(){
  const st = document.getElementById('home-stat-market'); if (st) st.textContent = MARKET_RECAP.month || '\u2014';
  const sub = document.getElementById('mk-sub'); if (sub) sub.innerHTML = esc(MARKET_RECAP.month) + ' recap, updated ' + esc(MARKET_RECAP.updated);
  refreshAll();
  (async () => {
    try { DB = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch (_) { DB = null; }
    if (!DB) return;
    const val = snap => { const d = snap && (typeof snap.data === 'function' ? snap.data() : snap); return (snap && snap.exists === false) ? null : (d || null); };
    DB.doc('market/sales').onSnapshot(s => { const d = val(s); setSales(d && Array.isArray(d.customers) ? d : null); }, () => {});
    DB.doc('market/hides').onSnapshot(s => { const d = val(s) || {}; HIDE = {flags: d.flags || [], accounts: d.accounts || []}; if (visibleView() === 'flag') drawFlags(); }, () => {});
  })();
})();

})();
