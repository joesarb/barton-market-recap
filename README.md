# barton-market-recap
Barton Solvents Monthly Market Recap

## Monthly update checklist (index.html)
0. FIRST, archive the month being replaced: `python3 tools/archive_month.py`
   (saves a frozen copy + its tariff PDF under `archive/` and adds it to the "Past months" menu)
   Then, AFTER updating index.html with the new month, refresh the trend strips: `python3 tools/build_history.py`
   (fills each product's "Trend history" from the archived months; the current month is added by the page)
- Header date, `<title>`, and the "Market Overview" paragraph block
- Each product row: trend badge/class, `data-trend`, Bottom Line, Full Detail
  - Trend badges use these emoji arrows: Up ⬆️, Stable to Up ↗️, Stable ➡️, Stable to Down ↘️, Down ⬇️, Volatile ⚡ (the page's JS uses the same set)
- Each product row also carries two fields used by the Quick view and Listen:
  - `data-line` - the one-line takeaway shown on the quick card (and read aloud)
  - `data-prev` - last month's trend, so a "NEW TREND" tag appears when it changed
- Iran war banner text (Listen reads its first sentence)
- Tariff Timeline: add the new month, update the intro date, and replace the PDF + link

## Regenerate the listenable audio (after index.html is final)
Every Listen button plays its own small audio file (Heart voice, natural sounding, no login needed). They must be
rebuilt every month, otherwise they will describe last month's data:

    pip install kokoro-onnx soundfile        # one time; ffmpeg must be installed
    # one-time download (not committed): kokoro-v1.0.int8.onnx + voices-v1.0.bin
    #   https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
    python3 tools/make_briefing.py --model kokoro-v1.0.int8.onnx --voices voices-v1.0.bin

This writes `audio/` (about 17 MB, ~12 minutes to build):
- `briefing.mp3` - each product + trend + one-line takeaway, in page order (highlight marks are in `manifest.json`)
- `overview.mp3` - the full market overview
- `bl/<product>.mp3` - each Bottom Line, `fd/<product>.mp3` - each Full Detail
- `manifest.json` - file names and lengths (the page reads this)

Each file ends with a short silent tail and plays to its natural end. If the files are missing the page falls back to
the phone's built-in voice. Listen buttons are on each block's heading line (Bottom Line, Full Detail, Market Overview).
