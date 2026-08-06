# Line2Relief — Depth Map Generator

Converts a black-and-white line drawing into a smooth, shaded grayscale depth map.

## Browser PWA (offline, in-browser)
Files: `index.html`, `app.js`, `depthgen.js`, `style.css`, `sw.js`, `manifest.webmanifest`, `icons/`

Run:
```bash
python3 -m http.server 8080
# open http://localhost:8080
```
- Upload a line drawing (or **Try a sample**).
- Pick a **Style**: `DepthGen` (default), `Smooth`, or `Crisp`.
- Main controls: **Line threshold**, **Background** level.
- Advanced: **Gamma**, **Relief height**, **Depth levels** (0 = smooth, default).
- **Fill black**: click, then drag on the canvas to paint problem areas black.
  **Clear fill** removes painted areas.
- **Save PNG** to download.

## Approach
- Each enclosed white region is raised as a smooth dome, normalized to its own peak.
- Ink lines between forms are filled from the surrounding surface — they read as
  light boundaries, **not** dark outlines.
- Only the true outer background is darkened, giving depth without hiding detail.
- Output is sharpened (minimal smoothing) for crisp edges.

## Python CLI
```bash
pip install numpy scipy opencv-python pillow
python3 depthgen.py input.png output.png [--thr 0.62] [--gamma 0.5] [--top 0.6] [--bg 0.08] [--levels 0]
```
