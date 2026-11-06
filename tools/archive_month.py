#!/usr/bin/env python3
"""Archive one month's page so it shows up in the "Past months" menu.

Run this each month BEFORE replacing index.html with the new month:

    python3 tools/archive_month.py                 # archives the current index.html
    python3 tools/archive_month.py --src old.html --pdf-dir folder_with_pdfs   # (used for backfilling)

It writes archive/<yyyy-mm>/index.html (frozen copy + an "Archived" banner + the tariff PDF it links to)
and updates archive/index.json, which the menu on the live page reads. Safe to re-run (same month = overwritten).
The Listen audio and the menu are intentionally not carried into archived pages.
"""
import argparse, json, os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BANNER = ('<div id="archiveBanner" style="background:#1f2a44;color:#fff;padding:12px 16px;font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center">'
          '&#128193; Archived: <b>{label}</b> (updated {updated}). Numbers here are from that month. '
          '<a href="../../" style="color:#ffd27a;font-weight:700;white-space:nowrap">View current &rarr;</a></div>')
STYLE = '<style id="archiveStyle">#archiveSelect,.listen-row,.mini-player{display:none !important}</style>'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=os.path.join(ROOT, 'index.html'))
    ap.add_argument('--pdf-dir', default=None, help='folder holding the PDFs the page links to (default: next to --src)')
    ap.add_argument('--out', default=os.path.join(ROOT, 'archive'))
    a = ap.parse_args()

    html = open(a.src, encoding='utf-8').read()
    u = re.search(r'Updated\s+(\d+)\s*/\s*(\d+)\s*/\s*(\d+)', html)
    t = re.search(r'<title>(?:Chemical Market Analysis\s*[—-]\s*)?([^<]*)</title>', html)
    if not u:
        sys.exit('Could not find the "Updated mm / dd / yyyy" date in the page')
    mm, dd, yy = int(u.group(1)), int(u.group(2)), int(u.group(3))
    month_id = f'{yy}-{mm:02d}'
    label = (t.group(1).strip() if t else month_id)
    updated = f'{mm}/{dd}/{yy}'

    folder = os.path.join(a.out, month_id)
    os.makedirs(folder, exist_ok=True)

    # keep the tariff PDF(s) this page links to, so the link still works from the archive folder
    pdf_dir = a.pdf_dir or os.path.dirname(os.path.abspath(a.src))
    for href in set(re.findall(r'href="([^"/]+\.pdf)"', html)):
        src_pdf = os.path.join(pdf_dir, href)
        if os.path.exists(src_pdf):
            shutil.copy(src_pdf, os.path.join(folder, href))
        else:
            print(f'warning: {href} not found in {pdf_dir}; its link will not work in the archive', file=sys.stderr)

    out = re.sub(r'(<body[^>]*>)', lambda m: m.group(1) + BANNER.format(label=label, updated=updated), html, count=1)
    out = out.replace('</head>', STYLE + '</head>', 1)
    if 'name="robots"' not in out:
        out = out.replace('</head>', '<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">\n</head>', 1)
    out = out.replace('<title>', '<title>Archive - ', 1)
    open(os.path.join(folder, 'index.html'), 'w', encoding='utf-8').write(out)

    idx_path = os.path.join(a.out, 'index.json')
    idx = json.load(open(idx_path)) if os.path.exists(idx_path) else []
    idx = [e for e in idx if e['id'] != month_id]
    idx.append({'id': month_id, 'label': label, 'updated': updated, 'path': f'archive/{month_id}/index.html'})
    idx.sort(key=lambda e: e['id'], reverse=True)
    json.dump(idx, open(idx_path, 'w'), indent=1)
    print(f'archived {label} (updated {updated}) -> archive/{month_id}/')


if __name__ == '__main__':
    main()
