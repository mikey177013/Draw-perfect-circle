# Perfect Circle

Draw a circle. Get scored on how perfect it is.

A minimal, premium clone of [neal.fun/perfect-circle](https://neal.fun/perfect-circle/) with clean typography, smooth canvas drawing, accurate scoring math, and zero clutter.

## Features

- Fullscreen canvas with mouse / touch / pen support
- DPR-aware crisp rendering
- Smooth quadratic-curve stroke (no jagged lines)
- Accurate score based on radial deviation, closure, and angular coverage
- Animated overlay of the *perfect* circle after release
- Best score saved to `localStorage`
- SVG icons, no emoji
- Black background, Instrument Serif italic for the score

## Run locally

Just open `index.html` in a browser, or:

```bash
npm start
```

## Deploy to Vercel

This is a pure static site — push to GitHub and import on Vercel, or:

```bash
npx vercel --prod
```

No build step is required.

## How scoring works

1. Compute centroid of all sampled points.
2. Compute mean radius from centroid.
3. Compute mean absolute radial deviation, normalized by radius.
4. Apply small penalties for poor closure (start ≠ end) and incomplete sweep (< 360°).
5. Clamp to 0–100.

```
score = 100 − (meanError / radius × 100) − closurePenalty − coveragePenalty
```

## Files

- `index.html` — markup
- `style.css` — styling
- `script.js` — canvas + scoring logic
- `vercel.json` — caching/headers
