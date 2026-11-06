# barton-market-recap
Barton Solvents Monthly Market Recap

## Monthly update checklist (index.html)
- Header date, `<title>`, and the "Market Overview" paragraph block
- Each product row: trend badge/class, `data-trend`, Bottom Line, Full Detail
- Each product row also carries two fields used by the Quick view and Listen:
  - `data-line` - the one-line takeaway shown on the quick card (and read aloud)
  - `data-prev` - last month's trend, so a "NEW TREND" tag appears when it changed
- Iran war banner text (Listen reads its first sentence)
- Tariff Timeline: add the new month, update the intro date, and replace the PDF + link

## Regenerate the listenable briefing (after index.html is final)
Listen plays real audio files (natural voice, works with lock-screen/car controls). They must be rebuilt
every month, otherwise they will describe last month's data:

    pip install kokoro-onnx soundfile        # one time; ffmpeg must be installed
    # one-time download (not committed): kokoro-v1.0.int8.onnx + voices-v1.0.bin
    #   https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
    python3 tools/make_briefing.py --model kokoro-v1.0.int8.onnx --voices voices-v1.0.bin

This writes `briefing-af_heart.mp3/.json` and `briefing-am_michael.mp3/.json`
(the page falls back to the phone's built-in voice if the files are missing).
