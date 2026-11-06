#!/usr/bin/env python3
"""Generate the listenable briefing (one MP3 + timing JSON per voice) from index.html.

Uses the open Kokoro voice model, so the audio plays from a plain link (no login, no API).
Run each month AFTER index.html is updated:

  pip install kokoro-onnx soundfile          # one time (also needs ffmpeg on PATH)
  # one-time download, not committed: kokoro-v1.0.int8.onnx and voices-v1.0.bin from
  #   https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
  python3 tools/make_briefing.py --model kokoro-v1.0.int8.onnx --voices voices-v1.0.bin

Outputs briefing-<voice>.mp3 and briefing-<voice>.json in the repo root (voices: af_heart, am_michael).
The audio follows the page order: intro, Iran, then each category and its products.
"""
import argparse, html, json, os, re, subprocess, sys, tempfile, datetime
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
VOICES = ['af_heart', 'am_michael']
SPELL = ['US','PGP','PDH','IPA','MEK','MEA','DEA','TEA','MEG','DEG','TEG','HTF','PET','TOTM','DOTP','DINP','DIDP','RVO','ICIS',
         'DPG','PG','PM','DPM','EB','DB','RV','EO','PP','PO','ULSD','PVC','UNL','MS','USDA','EPA','OPEC']

def speakable(t):
    t = re.sub(r'\+(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)¢', r'plus \1 to \2 cents', t)
    t = re.sub(r'\+(\d+(?:\.\d+)?)¢', r'plus \1 cents', t)
    t = t.replace('¢', ' cents')
    t = re.sub(r'\b(\d{1,2})/(\d{1,2})\b', lambda m: f"{MONTHS[int(m.group(1))-1]} {m.group(2)}" if 1 <= int(m.group(1)) <= 12 else m.group(0), t)
    t = re.sub(r'(\d)-(\d)', r'\1 to \2', t)
    t = t.replace('%', ' percent').replace('~', 'about ').replace('&', ' and ').replace('/', ' ')
    t = re.sub(r'\bcpp\b', 'cents per pound', t)
    t = re.sub(r"'(\d\d)\b", lambda m: 'twenty ' + m.group(1), t)
    t = re.sub(r'\bVM and P\b', 'V M and P', t)
    for a, b in [('thru','through'),('EOY','end of year'),('EOM','end of month'),('FM','force majeure'),('avg','average'),
                 ('Oct','October'),('Nov','November'),('Dec','December'),('Q1','Q one'),('Q2','Q two'),('Q3','Q three'),('Q4','Q four')]:
        t = re.sub(r'\b' + a + r'\b', b, t)
    t = re.sub(r'\b(' + '|'.join(SPELL) + r')\b', lambda m: ' '.join(m.group(1)), t)
    return re.sub(r'\s+', ' ', t).strip()

def parse_page(src):
    sub = re.search(r'Updated\s+(\d+)\s*/\s*(\d+)\s*/\s*(\d+)', src)
    when = f" Updated {MONTHS[int(sub.group(1))-1]} {int(sub.group(2))}." if sub else ''
    war = re.search(r'<div class="war-banner[^"]*"[^>]*>\s*<h2>(.*?)</h2>\s*<p>(.*?)</p>', src, re.S)
    war_short = re.split(r'(?<=\.)\s', html.unescape(war.group(2)).strip())[0]
    cats = []
    for chunk in src.split('<div class="section-label')[1:]:
        rows = []
        for m in re.finditer(r'<div class="product-row trend-[a-z-]+" data-trend="([a-z-]+)"([^>]*)>\s*<div class="product-row-header".*?<div class="product-name">([^<]+)</div>.*?'
                             r'<div class="synopsis"><span class="synopsis-label">[^<]*</span>(.*?)</div>', chunk, re.S):
            attrs = dict(re.findall(r'data-([a-z]+)="([^"]*)"', m.group(2)))
            rows.append(dict(trend=m.group(1), name=html.unescape(m.group(3)), line=html.unescape(attrs.get('line', '')),
                             new=bool(attrs.get('prev')) and attrs.get('prev') != m.group(1), bl=html.unescape(m.group(4)).strip()))
        if rows:
            label = re.sub(r'<[^>]+>', ' ', chunk.split('<div class="section-controls">')[0].split('>', 1)[1])
            cats.append((re.sub(r'\s+', ' ', html.unescape(label)).strip(), rows))
    return when, war_short, cats

def render(k, voice, speed, when, war_short, cats, out):
    sr = 24000
    parts, marks, t = [], [], 0.0
    def add(key, text, gap):
        nonlocal t
        samples, rate = k.create(speakable(text), voice=voice, speed=speed, lang='en-us')
        assert rate == sr
        marks.append({'key': key, 'start': round(t, 2)})
        pad = np.zeros(int(sr * gap), dtype=np.float32)
        parts.extend([samples.astype(np.float32), pad]); t += (len(samples) + len(pad)) / sr
        print(f'[{voice}] {t:7.1f}s  {key}', file=sys.stderr, flush=True)
    rows = [r for _, rs in cats for r in rs]
    rising = sum(r['trend'] in ('up', 'stable-up') for r in rows)
    soft = sum(r['trend'] in ('stable-down', 'down') for r in rows)
    flat = len(rows) - rising - soft
    new = sum(r['new'] for r in rows)
    add('b:intro', 'Barton Solvents chemical market update.' + when + f' {rising} products rising, {flat} flat or volatile, and {soft} softening.'
        + (f' {new} changed trend since last month.' if new else ''), 0.6)
    add('b:war', 'Iran war. ' + war_short, 0.8)
    for label, rs in cats:
        add('b:c:' + label, f"{label}. {len(rs)} products.", 0.5)
        for r in rs:
            add('b:i:' + r['name'], r['name'] + (', new trend' if r['new'] else '') + '. ' + r['line'] + '.', 0.45)
    add('b:end', 'End of briefing.', 0.3)
    briefing_end = round(t, 2)
    parts.append(np.zeros(int(sr * 1.0), dtype=np.float32)); t += 1.0
    for r in rows:
        add('d:' + r['name'], r['name'] + '. ' + r['bl'], 0.8)
    wav = np.concatenate(parts)
    with tempfile.TemporaryDirectory() as td:
        w = os.path.join(td, 'b.wav'); sf.write(w, wav, sr)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', w, '-ac', '1', '-ar', '24000', '-b:a', '56k',
                        os.path.join(out, f'briefing-{voice}.mp3')], check=True)
    json.dump({'voice': voice, 'generated': datetime.date.today().isoformat(), 'briefingEnd': briefing_end,
               'duration': round(t, 2), 'marks': marks}, open(os.path.join(out, f'briefing-{voice}.json'), 'w'), indent=1)
    print(f'[{voice}] done: briefing {briefing_end}s, total {t:.0f}s, {len(marks)} marks', file=sys.stderr, flush=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True); ap.add_argument('--voices', required=True)
    ap.add_argument('--voice', action='append', help='repeatable; default: both voices')
    ap.add_argument('--speed', type=float, default=1.05); ap.add_argument('--out', default=ROOT)
    a = ap.parse_args()
    src = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    when, war_short, cats = parse_page(src)
    k = Kokoro(a.model, a.voices)
    for v in (a.voice or VOICES):
        render(k, v, a.speed, when, war_short, cats, a.out)

if __name__ == '__main__':
    main()
