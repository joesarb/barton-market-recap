#!/usr/bin/env python3
"""Generate every listenable audio clip from index.html with the open Kokoro voice (Heart).

Plays from a plain link: no login, no API. One small file per section so each plays from its first word to its
final period and stops by itself (no seeking inside a long file, which phones do imprecisely).

Run each month AFTER index.html is updated:

  pip install kokoro-onnx soundfile          # one time (also needs ffmpeg on PATH)
  # one-time download, not committed: kokoro-v1.0.int8.onnx and voices-v1.0.bin from
  #   https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
  python3 tools/make_briefing.py --model kokoro-v1.0.int8.onnx --voices voices-v1.0.bin

Writes audio/ in the repo root:
  briefing.mp3          each product + its trend + the one-line takeaway, in page order (marks are in manifest.json)
  overview.mp3          the full market overview
  bl/<slug>.mp3         each product's Bottom Line
  fd/<slug>.mp3         each product's Full Detail
  manifest.json         file names, durations, briefing marks (the page reads this)
"""
import argparse, html, json, os, re, subprocess, sys, tempfile, datetime
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
VOICE = 'af_heart'
TREND_SAY = {'up': 'Up', 'stable-up': 'Stable to up', 'stable': 'Stable', 'stable-down': 'Stable to down', 'down': 'Down', 'volatile': 'Volatile'}
# ALL-CAPS acronyms (2-5 letters) are marked here and then pronounced letter by letter, run together with no pauses,
# by giving the voice the exact phonemes for each letter name (so "A" is "ay", never the word "uh").
SAY_AS_WORD = {'OPEC': 'OPEC', 'PET': 'pet'}      # acronyms people say as a word
SAY_AS = {'ICIS': 'eye sis'}                      # special pronunciations
LB, RB = '\u27e6', '\u27e7'                       # markers around letters to spell out
# (G, J and H use the model's single-token affricates ʤ / ʧ, not 'dʒ' / 'tʃ' typed as two sounds, which blurred the E before G.)
LETTER_PH = {'A': 'ˈeɪ', 'B': 'bˈiː', 'C': 'sˈiː', 'D': 'dˈiː', 'E': 'ˈiː', 'F': 'ˈɛf', 'G': 'ʤˈiː', 'H': 'ˈeɪʧ',
             'I': 'ˈaɪ', 'J': 'ʤˈeɪ', 'K': 'kˈeɪ', 'L': 'ˈɛl', 'M': 'ˈɛm', 'N': 'ˈɛn', 'O': 'ˈoʊ', 'P': 'pˈiː',
             'Q': 'kjˈuː', 'R': 'ˈɑːɹ', 'S': 'ˈɛs', 'T': 'tˈiː', 'U': 'jˈuː', 'V': 'vˈiː', 'W': 'dˈʌbəljˌuː',
             'X': 'ˈɛks', 'Y': 'wˈaɪ', 'Z': 'zˈiː'}


def spell_acronym(m):
    w = m.group(0)
    if w in SAY_AS_WORD: return SAY_AS_WORD[w]
    if w in SAY_AS: return SAY_AS[w]
    return LB + w + RB


def to_phonemes(tokenizer, text):
    """Phonemize normal words with the model's tokenizer; spell marked acronyms with exact letter phonemes."""
    out = []
    for part in re.split('(' + LB + '[A-Z]+' + RB + ')', text):
        if not part.strip():
            continue
        if part.startswith(LB):
            out.append(''.join(LETTER_PH[c] for c in part[1:-1]))
        else:
            out.append(tokenizer.phonemize(part.strip(), 'en-us').strip())
    return ' '.join(out)


def speakable(t):
    t = re.sub(r'\+(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)¢', r'plus \1 to \2 cents', t)
    t = re.sub(r'\+(\d+(?:\.\d+)?)¢', r'plus \1 cents', t)
    t = t.replace('¢', ' cents')
    t = re.sub(r'\b1 cents\b', '1 cent', t)
    t = re.sub(r'\b(\d{1,2})/(\d{1,2})\b', lambda m: f"{MONTHS[int(m.group(1))-1]} {m.group(2)}" if 1 <= int(m.group(1)) <= 12 else m.group(0), t)
    t = re.sub(r'(\d)-(\d)', r'\1 to \2', t)
    t = t.replace('%', ' percent').replace('~', 'about ').replace('&', ' and ')
    t = t.replace(' / ', ', ').replace('/', ' ')
    t = t.replace('(', ' ').replace(')', ' ')                                       # no pause for "(P-Series)"
    t = re.sub(r'\bcpp\b', 'cents per pound', t)
    t = re.sub(r"'(\d\d)\b", lambda m: 'twenty ' + m.group(1), t)
    for a, b in [('thru','through'),('EOY','end of year'),('EOM','end of month'),('FM','force majeure'),('avg','average'),
                 ('Oct','October'),('Nov','November'),('Dec','December'),('Q1','Q one'),('Q2','Q two'),('Q3','Q three'),('Q4','Q four')]:
        t = re.sub(r'\b' + a + r'\b', b, t)
    t = re.sub(r'(?<![A-Za-z])[A-Z]{2,5}(?![a-z])', spell_acronym, t)           # every other ALL-CAPS acronym
    t = re.sub(r'\s+([,;:])', r'\1', t)                                         # no space before , ; :
    return re.sub(r'\s+', ' ', t).strip()


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def clean(t):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', t))).strip()


def parse_page(src):
    rows = []
    for m in re.finditer(r'<div class="product-row trend-[a-z-]+" data-trend="([a-z-]+)"([^>]*)>\s*<div class="product-row-header".*?<div class="product-name">([^<]+)</div>.*?'
                         r'<div class="synopsis"><span class="synopsis-label">[^<]*</span>(.*?)</div>\s*<div class="full-detail-head">.*?</div>\s*<div class="full-detail-text">(.*?)</div>', src, re.S):
        attrs = dict(re.findall(r'data-([a-z]+)="([^"]*)"', m.group(2)))
        rows.append(dict(trend=m.group(1), name=html.unescape(m.group(3)).strip(), line=html.unescape(attrs.get('line', '')),
                         bl=clean(m.group(4)), fd=clean(m.group(5))))
    mo = re.search(r'<div class="macro-header"[^>]*>\s*<h2>(.*?)</h2>.*?<div class="macro-body">(.*?)</div>\s*</div>', src, re.S)
    overview = dict(title=clean(mo.group(1)), paragraphs=[clean(p) for p in re.findall(r'<p>(.*?)</p>', mo.group(2), re.S)])
    return rows, overview


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True); ap.add_argument('--voices', required=True)
    ap.add_argument('--voice', default=VOICE)
    ap.add_argument('--speed', type=float, default=1.05); ap.add_argument('--out', default=os.path.join(ROOT, 'audio'))
    ap.add_argument('--only', help='comma list of: briefing,overview,bl,fd (default: all)')
    a = ap.parse_args()
    parts_wanted = set((a.only or 'briefing,overview,bl,fd').split(','))
    src = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    rows, overview = parse_page(src)
    assert len(rows) == 22 and all(r['bl'] and r['fd'] for r in rows), 'could not parse every product'
    k = Kokoro(a.model, a.voices)
    SR = 24000

    def speak(text):
        ph = to_phonemes(k.tokenizer, speakable(text))
        samples, rate = k.create(ph, voice=a.voice, speed=a.speed, lang='en-us', is_phonemes=True)
        assert rate == SR
        return samples.astype(np.float32)

    def silence(sec):
        return np.zeros(int(SR * sec), dtype=np.float32)

    def write(samples, rel):
        path = os.path.join(a.out, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        samples = np.concatenate([samples, silence(0.4)])        # silent tail: the clip ends cleanly, never mid-word
        with tempfile.TemporaryDirectory() as td:
            w = os.path.join(td, 'x.wav'); sf.write(w, samples, SR)
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', w, '-ac', '1', '-ar', str(SR), '-c:a', 'libmp3lame',
                            '-b:a', '56k', path], check=True)
        return round(len(samples) / SR, 2)

    mf_path = os.path.join(a.out, 'manifest.json')
    manifest = json.load(open(mf_path)) if os.path.exists(mf_path) else {}
    manifest.update({'voice': a.voice, 'generated': datetime.date.today().isoformat()})

    if 'briefing' in parts_wanted:
        pieces, marks, t = [], [], 0.0
        for r in rows:
            sp = speak(f"{r['name']}, {TREND_SAY[r['trend']]}. {r['line']}.")
            marks.append({'key': 'b:i:' + r['name'], 'start': round(t, 2), 'end': round(t + len(sp) / SR, 2)})
            pad = silence(0.45); pieces += [sp, pad]; t += (len(sp) + len(pad)) / SR
            print(f'briefing {t:6.1f}s {r["name"]}', file=sys.stderr, flush=True)
        dur = write(np.concatenate(pieces), 'briefing.mp3')
        manifest['briefing'] = {'file': 'briefing.mp3', 'duration': dur, 'marks': marks}
    if 'overview' in parts_wanted:
        pieces = [speak(overview['title'] + '.'), silence(0.6)]
        for ptxt in overview['paragraphs']:
            pieces += [speak(ptxt), silence(0.6)]
        dur = write(np.concatenate(pieces), 'overview.mp3')
        manifest['overview'] = {'file': 'overview.mp3', 'duration': dur}
        print(f'overview {dur}s', file=sys.stderr, flush=True)
    for kind, field in (('bl', 'bl'), ('fd', 'fd')):
        if kind not in parts_wanted: continue
        manifest[kind] = {}
        for r in rows:
            dur = write(np.concatenate([speak(f"{r['name']}, {TREND_SAY[r['trend']]}. {r[field]}")]), f'{kind}/{slug(r["name"])}.mp3')
            manifest[kind][r['name']] = {'file': f'{kind}/{slug(r["name"])}.mp3', 'duration': dur}
            print(f'{kind} {dur:6.1f}s {r["name"]}', file=sys.stderr, flush=True)
    json.dump(manifest, open(mf_path, 'w'), indent=1)
    print('done', file=sys.stderr, flush=True)


if __name__ == '__main__':
    main()
